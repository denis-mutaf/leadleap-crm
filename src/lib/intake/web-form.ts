import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { humanizeKey, parseFormFields } from "./field-synonyms";

export const INTAKE_CHANNEL = "web_form";
export const INTAKE_KIND = "form_submit";
export const WEB_FORM_SOURCE_CODE = "web_form";

// Хеш тела плюс текущая минута UTC: двойной сабмит в пределах минуты
// ложится на тот же dedup_key и не порождает вторую сделку.
export function buildDedupKey(body: Record<string, unknown>, now = new Date()): string {
  const minute = now.toISOString().slice(0, 16);
  const hash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  return `web_form:${minute}:${hash}`;
}

function failBody(note: string): string {
  return `Обращение с формы сайта (${note})`;
}

interface IntakeSuccess {
  dealId: string;
  eventId: string;
  duplicate: boolean;
}

// Разбирает уже сохранённое сырое событие и создаёт/дополняет сделку.
// Бросает исключение — вызыватель пишет его текст в inbound_events.error.
export async function processWebFormEvent(
  admin: SupabaseClient,
  eventId: string,
  rawBody: Record<string, unknown>,
): Promise<IntakeSuccess> {
  const parsed = parseFormFields(rawBody);
  if (!parsed.phone) throw new Error("В форме нет телефона");

  // Нормализация номера — функцией базы, а не копией на TypeScript.
  const { data: normalized, error: normError } = await admin.rpc("normalize_phone", {
    raw: parsed.phone,
  });
  const phone = (normalized as string | null) ?? null;
  if (normError) throw new Error(`Не удалось нормализовать телефон: ${normError.message}`);
  if (!phone) throw new Error("Телефон не распознан");

  const { data: existingPhone, error: phoneError } = await admin
    .from("contact_phones")
    .select("contact_id")
    .eq("phone", phone)
    .maybeSingle();
  if (phoneError) throw phoneError;

  let contactId: string = (existingPhone?.contact_id as string | undefined) ?? "";
  if (!contactId) {
    const { data: contact, error: contactError } = await admin
      .from("contacts")
      .insert({ full_name: parsed.name || "Без имени" })
      .select("id")
      .single();
    if (contactError) throw contactError;
    contactId = contact.id as string;
    const { error: insertPhoneError } = await admin
      .from("contact_phones")
      .insert({ contact_id: contactId, phone, is_primary: true });
    if (insertPhoneError) throw insertPhoneError;
  }

  // Открытая сделка контакта: статус не выигран/не проигран.
  const { data: openDeal, error: dealLookupError } = await admin
    .from("deals")
    .select("id")
    .eq("contact_id", contactId)
    .not("status", "in", "(won,lost)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (dealLookupError) throw dealLookupError;

  let dealId = (openDeal?.id as string | undefined) ?? "";
  let duplicate = false;

  if (dealId) {
    duplicate = true;
    // Обращение дописываем примечанием к существующей сделке.
    const { error: noteError } = await admin.from("notes").insert({
      deal_id: dealId,
      body: parsed.comment || failBody(`повторное обращение ${parsed.name ?? ""}`.trim()),
    });
    if (noteError) throw noteError;
  } else {
    const { data: stage, error: stageError } = await admin
      .from("stages")
      .select("id")
      .eq("is_active", true)
      .order("position", { ascending: true })
      .limit(1)
      .single();
    if (stageError) throw stageError;

    const { data: source, error: sourceError } = await admin
      .from("sources")
      .select("id")
      .eq("code", WEB_FORM_SOURCE_CODE)
      .maybeSingle();
    if (sourceError) throw sourceError;
    if (!source) throw new Error("В справочнике sources нет кода web_form");

    const title = parsed.name ? `Форма сайта: ${parsed.name}` : "Форма сайта";
    const { data: deal, error: dealError } = await admin
      .from("deals")
      // Общий котёл: owner_id пустой, ответственного назначат вручную.
      .insert({
        contact_id: contactId,
        stage_id: (stage as { id: string }).id,
        source_id: (source as { id: string }).id,
        title,
        utm: parsed.utm,
        meta_campaign_id: parsed.metaCampaignId ?? null,
        first_inbound_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (dealError) throw dealError;
    dealId = (deal as { id: string }).id;

    if (parsed.comment) {
      const { error: noteError } = await admin
        .from("notes")
        .insert({ deal_id: dealId, body: parsed.comment });
      if (noteError) throw noteError;
    }
  }

  // Незнакомые поля формы: завести определение и записать значение.
  // Требование заказчика: новое поле формы подтягивается без разработчика.
  const unknownKeys = Object.keys(parsed.unknown);
  if (unknownKeys.length > 0) {
    const { data: defs, error: defsError } = await admin
      .from("custom_field_defs")
      .select("id,key")
      .eq("entity", "deal");
    if (defsError) throw defsError;
    const byKey = new Map((defs as { id: string; key: string }[]).map((d) => [d.key, d.id]));

    for (const key of unknownKeys) {
      let fieldId = byKey.get(key);
      if (!fieldId) {
        const { data: created, error: createError } = await admin
          .from("custom_field_defs")
          .insert({
            entity: "deal",
            key,
            label: humanizeKey(key),
            field_type: "text",
            auto_created: true,
          })
          .select("id")
          .single();
        if (createError) throw createError;
        fieldId = (created as { id: string }).id;
        byKey.set(key, fieldId);
      }
      const { error: valueError } = await admin.from("custom_field_values").upsert(
        { field_id: fieldId, entity_id: dealId, value: parsed.unknown[key] },
        { onConflict: "field_id,entity_id" },
      );
      if (valueError) throw valueError;
    }
  }

  const { error: markError } = await admin
    .from("inbound_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("id", eventId);
  if (markError) throw markError;

  return { dealId, eventId, duplicate };
}
