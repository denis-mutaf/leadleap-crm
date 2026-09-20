import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildDedupKey, INTAKE_CHANNEL, INTAKE_KIND, processWebFormEvent } from "@/lib/intake/web-form";

export const runtime = "nodejs";

// Приёмник заявок с формы сайта. Только серверный код.
// Всегда сперва сохраняет сырое тело в inbound_events, затем разбирает.
export async function POST(req: Request) {
  const expected = process.env.WEB_FORM_TOKEN;
  const provided = req.headers.get("x-form-token");
  if (!expected || !provided || provided !== expected) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Тело принимаем и как JSON, и как application/x-www-form-urlencoded.
  const rawText = await req.text();
  let rawBody: Record<string, unknown> = {};
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    for (const [k, v] of new URLSearchParams(rawText)) rawBody[k] = v;
  } else {
    try {
      const parsed: unknown = rawText ? JSON.parse(rawText) : {};
      rawBody = (parsed ?? {}) as Record<string, unknown>;
    } catch {
      for (const [k, v] of new URLSearchParams(rawText)) rawBody[k] = v;
    }
    if (typeof rawBody !== "object" || rawBody === null || Array.isArray(rawBody)) {
      rawBody = { value: rawBody };
    }
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    // Свои сбои форме не показываем: чужая страница должна увидеть 200.
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const dedupKey = buildDedupKey(rawBody);

  // Двойной сабмит: такое событие уже есть — новую сделку не создаём.
  const { data: seen } = await admin
    .from("inbound_events")
    .select("id,processed_at")
    .eq("dedup_key", dedupKey)
    .maybeSingle();
  if (seen) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // Сырое событие пишем до разбора: даже упавший разбор оставляет след.
  const { data: event, error: insertError } = await admin
    .from("inbound_events")
    .insert({ channel: INTAKE_CHANNEL, kind: INTAKE_KIND, payload: rawBody, dedup_key: dedupKey })
    .select("id")
    .single();
  if (insertError || !event) {
    // Гонка двух одинаковых сабмитов: второй тихо выходим без дубля.
    if ((insertError as { code?: string } | null)?.code === "23505") {
      return NextResponse.json({ ok: true }, { status: 200 });
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  }
  const eventId = (event as { id: string }).id;

  try {
    const { dealId } = await processWebFormEvent(admin, eventId, rawBody);
    return NextResponse.json({ ok: true, deal_id: dealId }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin.from("inbound_events").update({ error: message }).eq("id", eventId);
    // processed_at остаётся пустым — событие можно переиграть.
    return NextResponse.json({ ok: true }, { status: 200 });
  }
}
