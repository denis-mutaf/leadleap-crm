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
  } catch (error) {
    console.error("web-form admin client unavailable", error);
    return NextResponse.json({ ok: false, error: "Temporary intake failure" }, { status: 503 });
  }

  const dedupKey = buildDedupKey(rawBody);

  // A processed duplicate is complete; an unprocessed one must be retried.
  const { data: seen, error: seenError } = await admin
    .from("inbound_events")
    .select("id, processed_at, payload")
    .eq("dedup_key", dedupKey)
    .maybeSingle();
  if (seenError) {
    console.error("web-form dedup lookup failed", seenError);
    return NextResponse.json({ ok: false, error: "Temporary intake failure" }, { status: 503 });
  }
  if (seen) {
    if (seen.processed_at) return NextResponse.json({ ok: true }, { status: 200 });
    try {
      const result = await processWebFormEvent(admin, seen.id, (seen.payload ?? rawBody) as Record<string, unknown>);
      return NextResponse.json({ ok: true, deal_id: result.dealId }, { status: 200 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await admin.from("inbound_events").update({ error: message }).eq("id", seen.id);
      return NextResponse.json({ ok: false, error: "Temporary intake failure" }, { status: 503 });
    }
  }

  // Сырое событие пишем до разбора: даже упавший разбор оставляет след.
  const { data: event, error: insertError } = await admin
    .from("inbound_events")
    .insert({ channel: INTAKE_CHANNEL, kind: INTAKE_KIND, payload: rawBody, dedup_key: dedupKey })
    .select("id")
    .single();
  if (insertError || !event) {
    // The concurrent winner owns the raw event; retry its unprocessed work.
    if ((insertError as { code?: string } | null)?.code === "23505") {
      const { data: winner, error: winnerError } = await admin
        .from("inbound_events")
        .select("id, processed_at, payload")
        .eq("dedup_key", dedupKey)
        .single();
      if (winnerError || !winner) {
        return NextResponse.json({ ok: false, error: "Temporary intake failure" }, { status: 503 });
      }
      if (winner.processed_at) return NextResponse.json({ ok: true }, { status: 200 });
      try {
        const result = await processWebFormEvent(admin, winner.id, winner.payload as Record<string, unknown>);
        return NextResponse.json({ ok: true, deal_id: result.dealId }, { status: 200 });
      } catch (error) {
        await admin.from("inbound_events").update({ error: error instanceof Error ? error.message : String(error) }).eq("id", winner.id);
        return NextResponse.json({ ok: false, error: "Temporary intake failure" }, { status: 503 });
      }
    }
    console.error("web-form event insert failed", insertError);
    return NextResponse.json({ ok: false, error: "Temporary intake failure" }, { status: 503 });
  }
  const eventId = (event as { id: string }).id;

  try {
    const { dealId } = await processWebFormEvent(admin, eventId, rawBody);
    return NextResponse.json({ ok: true, deal_id: dealId }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin.from("inbound_events").update({ error: message }).eq("id", eventId);
    // processed_at остаётся пустым — следующий retry переиграет событие.
    return NextResponse.json({ ok: false, error: "Temporary intake failure" }, { status: 503 });
  }
}
