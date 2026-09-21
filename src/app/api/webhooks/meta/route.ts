import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  channelFor,
  parseEvents,
  processLeadgen,
  processMessage,
  signatureValid,
} from "@/lib/intake/meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Facebook, Instagram и WhatsApp стучатся на один адрес: канал различается
// полем object в теле. Сырое событие пишется до разбора, как на остальных
// каналах, чтобы упавший разбор можно было переиграть, не теряя данные.

// Подтверждение адреса при подключении вебхука в кабинете Meta.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const expected = process.env.META_VERIFY_TOKEN;
  if (!expected) {
    console.error("META_VERIFY_TOKEN не задан");
    return new NextResponse("Not configured", { status: 503 });
  }
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode !== "subscribe" || token !== expected || !challenge) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  // Meta ждёт ровно challenge текстом, без кавычек и переводов строки.
  return new NextResponse(challenge, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export async function POST(req: Request) {
  const secret = process.env.META_APP_SECRET;
  const token = process.env.META_PAGE_ACCESS_TOKEN ?? process.env.META_SYSTEM_USER_TOKEN;
  if (!secret || !token) {
    console.error("Не заданы META_APP_SECRET или токен доступа");
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  // Подпись считается по сырому телу, поэтому читаем текстом, а не json().
  const raw = await req.text();
  if (!signatureValid(raw, req.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const channel = channelFor(payload.object);
  if (!channel) return NextResponse.json({ ok: true }, { status: 200 });

  let admin;
  try {
    admin = createAdminClient();
  } catch (error) {
    console.error("meta admin client unavailable", error);
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  const events = parseEvents(payload, channel);
  if (events.length === 0) return NextResponse.json({ ok: true }, { status: 200 });

  let failed = false;
  for (const event of events) {
    const dedupKey =
      event.type === "leadgen"
        ? `meta:leadgen:${event.leadgenId}`
        : `meta:message:${event.channel}:${event.externalId ?? `${event.threadId}:${event.sentAt}`}`;
    const kind = event.type === "leadgen" ? "leadgen" : `message:${event.direction}`;

    const { data: inserted, error: insertError } = await admin
      .from("inbound_events")
      .insert({
        channel: event.type === "leadgen" ? "lead_ads" : channel,
        kind,
        payload: event as unknown as Record<string, unknown>,
        dedup_key: dedupKey,
      })
      .select("id, processed_at")
      .single();

    let eventId = inserted?.id as string | undefined;
    if (insertError) {
      if ((insertError as { code?: string }).code !== "23505") {
        console.error("meta inbound insert failed", insertError);
        failed = true;
        continue;
      }
      // Повтор доставки: обработанный дубль пропускаем, зависший переигрываем.
      const { data: seen } = await admin
        .from("inbound_events")
        .select("id, processed_at")
        .eq("dedup_key", dedupKey)
        .maybeSingle();
      if (!seen || seen.processed_at) continue;
      eventId = seen.id as string;
    }
    if (!eventId) continue;

    try {
      if (event.type === "leadgen") {
        await processLeadgen(admin, eventId, event, token);
        // Лид помечает событие обработанным внутри транзакции RPC.
      } else {
        await processMessage(admin, event, token);
        await admin
          .from("inbound_events")
          .update({ processed_at: new Date().toISOString(), error: null })
          .eq("id", eventId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await admin.from("inbound_events").update({ error: message }).eq("id", eventId);
      failed = true;
    }
  }

  // Meta повторяет доставку только на не-200, поэтому ошибку не прячем.
  return NextResponse.json({ ok: !failed }, { status: failed ? 503 : 200 });
}
