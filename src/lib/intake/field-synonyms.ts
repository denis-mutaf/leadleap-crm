// Словарь синонимов полей формы сайта — в одном месте.
// Ключ сырой формы приводится к нижнему регистру без пробелов и ищется здесь.

export type CanonicalField =
  | "phone"
  | "name"
  | "email"
  | "comment"
  | "utm_source"
  | "utm_medium"
  | "utm_campaign"
  | "utm_content"
  | "utm_term"
  | "meta_campaign_id";

const SYNONYMS: Record<CanonicalField, string[]> = {
  phone: [
    "phone",
    "tel",
    "telefon",
    "telephone",
    "phone_number",
    "phonenumber",
    "mobile",
    "mobil",
    "tel_number",
    "contact_phone",
    "номер",
    "номер_телефона",
    "телефон",
  ],
  name: [
    "name",
    "fullname",
    "full_name",
    "firstname",
    "first_name",
    "lastname",
    "last_name",
    "fio",
    "nume",
    "prenume",
    "nume_prenume",
    "client_name",
    "имя",
    "фио",
  ],
  email: ["email", "e-mail", "mail", "e_mail", "posta", "почта", "эл_почта"],
  comment: [
    "comment",
    "comments",
    "message",
    "text",
    "mesaj",
    "comentariu",
    "descriere",
    "комментарий",
    "сообщение",
    "вопрос",
  ],
  utm_source: ["utm_source"],
  utm_medium: ["utm_medium"],
  utm_campaign: ["utm_campaign"],
  utm_content: ["utm_content"],
  utm_term: ["utm_term"],
  meta_campaign_id: ["meta_campaign_id", "fb_campaign_id", "campaign_id", "meta_campaign"],
};

const LOOKUP = new Map<string, CanonicalField>();
for (const [canonical, variants] of Object.entries(SYNONYMS) as [CanonicalField, string[]][]) {
  for (const v of variants) LOOKUP.set(normalizeKey(v), canonical);
}

export function normalizeKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function canonicalOf(rawKey: string): CanonicalField | null {
  return LOOKUP.get(normalizeKey(rawKey)) ?? null;
}

export interface ParsedForm {
  phone?: string;
  name?: string;
  email?: string;
  comment?: string;
  utm: Record<string, string>;
  metaCampaignId?: string;
  // Сырые ключи, не попавшие в словарь: кандидаты в пользовательские поля.
  unknown: Record<string, string>;
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

// Раскладывает сырое тело формы по каноническим полям.
// Имя собирает из first+last, если они пришли отдельно.
export function parseFormFields(raw: Record<string, unknown>): ParsedForm {
  const byCanonical = new Map<CanonicalField, string>();
  const unknown: Record<string, string> = {};
  let firstName = "";
  let lastName = "";

  for (const [rawKey, rawValue] of Object.entries(raw)) {
    const value = asString(rawValue);
    if (!value) continue;
    const canonical = canonicalOf(rawKey);
    if (!canonical) {
      unknown[normalizeKey(rawKey)] = value;
      continue;
    }
    const key = normalizeKey(rawKey);
    if (key === "first_name" || key === "firstname" || key === "prenume") {
      firstName = value;
      continue;
    }
    if (key === "last_name" || key === "lastname") {
      lastName = value;
      continue;
    }
    if (!byCanonical.has(canonical)) byCanonical.set(canonical, value);
  }

  if (!byCanonical.has("name") && (firstName || lastName)) {
    byCanonical.set("name", `${firstName} ${lastName}`.trim());
  }

  const utm: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const) {
    const v = byCanonical.get(k);
    if (v) utm[k] = v;
  }

  return {
    phone: byCanonical.get("phone"),
    name: byCanonical.get("name"),
    email: byCanonical.get("email"),
    comment: byCanonical.get("comment"),
    utm,
    metaCampaignId: byCanonical.get("meta_campaign_id"),
    unknown,
  };
}

// Человекочитаемая подпись для автозавведённого пользовательского поля.
export function humanizeKey(key: string): string {
  const words = key.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
