import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { humanizeKey, parseFormFields } from "./field-synonyms";

export const INTAKE_CHANNEL = "web_form";
export const INTAKE_KIND = "form_submit";

// Хеш тела плюс текущая минута UTC: двойной сабмит в пределах минуты
// ложится на тот же dedup_key и не порождает вторую сделку.
export function buildDedupKey(body: Record<string, unknown>, now = new Date()): string {
  const minute = now.toISOString().slice(0, 16);
  const hash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  return `web_form:${minute}:${hash}`;
}

interface IntakeSuccess {
  dealId: string;
  eventId: string;
  duplicate: boolean;
}

// Разбирает уже сохранённое сырое событие через одну database transaction.
// Бросает исключение — вызыватель пишет его текст в inbound_events.error.
export async function processWebFormEvent(
  admin: SupabaseClient,
  eventId: string,
  rawBody: Record<string, unknown>,
): Promise<IntakeSuccess> {
  const parsed = parseFormFields(rawBody);
  if (!parsed.phone) throw new Error("В форме нет телефона");

  const { data, error } = await admin.rpc("process_web_form_event", {
    p_event_id: eventId,
    p_phone: parsed.phone,
    p_name: parsed.name ?? null,
    p_comment: parsed.comment ?? null,
    p_utm: parsed.utm,
    p_meta_campaign_id: parsed.metaCampaignId ?? null,
    p_unknown: parsed.unknown,
    p_unknown_labels: Object.fromEntries(
      Object.keys(parsed.unknown).map((key) => [key, humanizeKey(key)]),
    ),
  });
  if (error) throw new Error(`Не удалось атомарно обработать заявку: ${error.message}`);
  const result = data as { deal_id?: string; duplicate?: boolean } | null;
  if (!result?.deal_id) throw new Error("Атомарная обработка не вернула сделку");
  return { dealId: result.deal_id, eventId, duplicate: result.duplicate ?? false };
}
