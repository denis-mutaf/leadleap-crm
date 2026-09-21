import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const GRAPH = "https://graph.facebook.com/v21.0";

export type MetaChannel = "facebook" | "instagram" | "whatsapp";

// Meta шлёт все каналы на один адрес и различает их полем object.
export function channelFor(object: unknown): MetaChannel | null {
  if (object === "page") return "facebook";
  if (object === "instagram") return "instagram";
  if (object === "whatsapp_business_account") return "whatsapp";
  return null;
}

// Подпись считается по сырому телу: пересобранный JSON даст другой хеш.
export function signatureValid(raw: string, header: string | null, secret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  const got = header.slice("sha256=".length);
  if (got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got, "utf8"), Buffer.from(expected, "utf8"));
}

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (value && typeof value === "object" ? (value as Json) : {});
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

// Одно тело от Meta может нести несколько событий; каждое разбирается отдельно,
// чтобы падение одного не съедало остальные.
export type MetaEvent =
  | { type: "leadgen"; leadgenId: string; pageId: string | null; formId: string | null; adId: string | null }
  | {
      type: "message";
      channel: MetaChannel;
      threadId: string;
      externalId: string | null;
      direction: "in" | "out";
      body: string | null;
      attachments: unknown[];
      sentAt: string;
    };

export function parseEvents(payload: Json, channel: MetaChannel): MetaEvent[] {
  const events: MetaEvent[] = [];
  for (const rawEntry of arr(payload.entry)) {
    const entry = obj(rawEntry);

    for (const rawChange of arr(entry.changes)) {
      const change = obj(rawChange);
      if (change.field !== "leadgen") continue;
      const value = obj(change.value);
      const leadgenId = str(value.leadgen_id);
      if (!leadgenId) continue;
      events.push({
        type: "leadgen",
        leadgenId,
        pageId: str(value.page_id) ?? str(entry.id),
        formId: str(value.form_id),
        adId: str(value.ad_id) ?? str(value.adgroup_id),
      });
    }

    for (const rawItem of arr(entry.messaging)) {
      const item = obj(rawItem);
      const message = obj(item.message);
      // is_echo — это наш же ответ, отправленный из другого интерфейса.
      const outgoing = message.is_echo === true;
      const sender = str(obj(item.sender).id);
      const recipient = str(obj(item.recipient).id);
      const threadId = outgoing ? recipient : sender;
      if (!threadId) continue;
      const timestamp = typeof item.timestamp === "number" ? item.timestamp : Number(item.timestamp);
      events.push({
        type: "message",
        channel,
        threadId,
        externalId: str(message.mid),
        direction: outgoing ? "out" : "in",
        body: str(message.text),
        attachments: arr(message.attachments),
        sentAt: new Date(Number.isFinite(timestamp) ? timestamp : Date.now()).toISOString(),
      });
    }
  }
  return events;
}

// Лид отдаётся только по запросу: в вебхуке приходит один идентификатор.
async function fetchLead(leadgenId: string, token: string): Promise<Json> {
  const url = `${GRAPH}/${leadgenId}?fields=id,created_time,field_data,ad_id,form_id&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  const body = (await res.json()) as Json;
  if (!res.ok) {
    const message = str(obj(body.error).message) ?? `HTTP ${res.status}`;
    throw new Error(`Не удалось забрать лид ${leadgenId}: ${message}`);
  }
  return body;
}

// Имена полей в форме задаёт рекламодатель, поэтому сопоставляем по смыслу.
const PHONE_KEYS = ["phone", "telefon", "телефон", "mobile", "numar"];
const NAME_KEYS = ["name", "nume", "имя", "full_name", "prenume"];
const EMAIL_KEYS = ["email", "e-mail", "почта"];

function pick(fields: Map<string, string>, keys: string[]): string | null {
  for (const [key, value] of fields) {
    if (keys.some((needle) => key.includes(needle))) return value;
  }
  return null;
}

export async function processLeadgen(
  admin: SupabaseClient,
  eventId: string,
  event: Extract<MetaEvent, { type: "leadgen" }>,
  token: string,
): Promise<string> {
  const lead = await fetchLead(event.leadgenId, token);
  const fields = new Map<string, string>();
  for (const rawField of arr(lead.field_data)) {
    const field = obj(rawField);
    const name = str(field.name)?.toLowerCase();
    const value = str(arr(field.values)[0]);
    if (name && value) fields.set(name, value);
  }
  const phone = pick(fields, PHONE_KEYS);
  if (!phone) throw new Error(`В лиде ${event.leadgenId} нет телефона`);

  const known = new Set([...PHONE_KEYS, ...NAME_KEYS, ...EMAIL_KEYS]);
  const unknown: Json = {};
  for (const [key, value] of fields) {
    if (![...known].some((needle) => key.includes(needle))) unknown[key] = value;
  }

  const email = pick(fields, EMAIL_KEYS);
  // Та же обработка, что у формы сайта: поиск дубля по телефону, сделка на
  // первом этапе, всё одной транзакцией. Отличается только источником.
  const { data, error } = await admin.rpc("process_web_form_event", {
    p_event_id: eventId,
    p_phone: phone,
    p_name: pick(fields, NAME_KEYS),
    p_comment: email ? `Почта: ${email}` : null,
    p_utm: { form_id: event.formId, ad_id: event.adId, leadgen_id: event.leadgenId },
    p_meta_campaign_id: event.adId,
    p_unknown: unknown,
    p_unknown_labels: Object.fromEntries(Object.keys(unknown).map((key) => [key, key])),
    p_source_code: "lead_ads",
  });
  if (error) throw new Error(`Не удалось обработать лид: ${error.message}`);
  const dealId = (data as { deal_id?: string } | null)?.deal_id;
  if (!dealId) throw new Error("Обработка лида не вернула сделку");
  return dealId;
}

// Имя в переписке — единственное, что Meta отдаёт о собеседнике: телефона нет.
async function threadName(threadId: string, token: string): Promise<string | null> {
  try {
    const res = await fetch(`${GRAPH}/${threadId}?fields=name,username&access_token=${encodeURIComponent(token)}`);
    if (!res.ok) return null;
    const body = (await res.json()) as Json;
    return str(body.name) ?? str(body.username);
  } catch {
    return null;
  }
}

const SOURCE_BY_CHANNEL: Record<MetaChannel, string> = {
  facebook: "facebook",
  instagram: "instagram",
  whatsapp: "whatsapp",
};

async function ensureConversation(
  admin: SupabaseClient,
  event: Extract<MetaEvent, { type: "message" }>,
  token: string,
): Promise<string> {
  const { data: existing, error: lookupError } = await admin
    .from("conversations")
    .select("id")
    .eq("channel", event.channel)
    .eq("external_thread_id", event.threadId)
    .maybeSingle();
  if (lookupError) throw new Error(`Поиск переписки не удался: ${lookupError.message}`);
  if (existing) return existing.id as string;

  // Новая переписка — это новый лид: заводим контакт и сделку, как на звонке.
  const name = (await threadName(event.threadId, token)) ?? `${event.channel}:${event.threadId}`;
  const { data: contact, error: contactError } = await admin
    .from("contacts")
    .insert({ full_name: name })
    .select("id")
    .single();
  if (contactError) throw new Error(`Не удалось завести контакт: ${contactError.message}`);
  const contactId = contact.id as string;

  const [{ data: stage }, { data: source }] = await Promise.all([
    admin.from("stages").select("id").eq("is_active", true).order("position").limit(1).maybeSingle(),
    admin.from("sources").select("id").eq("code", SOURCE_BY_CHANNEL[event.channel]).maybeSingle(),
  ]);
  const { error: dealError } = await admin.from("deals").insert({
    contact_id: contactId,
    stage_id: (stage?.id as string | undefined) ?? null,
    source_id: (source?.id as string | undefined) ?? null,
    first_inbound_at: event.sentAt,
  });
  if (dealError) throw new Error(`Не удалось завести сделку: ${dealError.message}`);

  const { data: created, error: createError } = await admin
    .from("conversations")
    .insert({
      channel: event.channel,
      external_thread_id: event.threadId,
      contact_id: contactId,
      last_message_at: event.sentAt,
    })
    .select("id")
    .single();
  if (createError) throw new Error(`Не удалось завести переписку: ${createError.message}`);
  return created.id as string;
}

export async function processMessage(
  admin: SupabaseClient,
  event: Extract<MetaEvent, { type: "message" }>,
  token: string,
): Promise<void> {
  const conversationId = await ensureConversation(admin, event, token);

  // Meta повторяет доставку при таймауте: ключ (переписка, mid) отсекает дубль.
  const { error: messageError } = await admin.from("messages").upsert(
    {
      conversation_id: conversationId,
      direction: event.direction,
      body: event.body,
      attachments: event.attachments,
      external_id: event.externalId,
      sent_at: event.sentAt,
    },
    { onConflict: "conversation_id,external_id", ignoreDuplicates: true },
  );
  if (messageError) throw new Error(`Не удалось записать сообщение: ${messageError.message}`);

  const { error: touchError } = await admin.rpc("crm_touch_conversation", {
    p_conversation: conversationId,
    p_sent_at: event.sentAt,
    p_incoming: event.direction === "in",
  });
  if (touchError) throw new Error(`Не удалось обновить переписку: ${touchError.message}`);
}
