export type DealFieldType = "text" | "number" | "date" | "select" | "checkbox";

export type DealFieldDefinition = {
  id: string;
  entity: "deal";
  key: string;
  label: string;
  field_type: DealFieldType;
  options: unknown;
  position: number;
  is_required: boolean;
};

export type DealFieldValue = {
  id: string;
  field_id: string;
  entity_id: string;
  value: unknown;
};

export const attributionKeys = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "UTM_ID",
  "fbclid",
  "FORMNAME",
  "TRANID",
  "_ym_uid",
] as const;

export type Attribution = Record<(typeof attributionKeys)[number], string | null>;

const attributionAliases: Record<(typeof attributionKeys)[number], string[]> = {
  utm_source: ["utm_source", "source"],
  utm_medium: ["utm_medium", "medium"],
  utm_campaign: ["utm_campaign", "campaign"],
  utm_content: ["utm_content", "content"],
  utm_term: ["utm_term", "term"],
  UTM_ID: ["UTM_ID", "utm_id"],
  fbclid: ["fbclid"],
  FORMNAME: ["FORMNAME", "formname", "form"],
  TRANID: ["TRANID", "tranid"],
  _ym_uid: ["_ym_uid", "ym_uid"],
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanScalar(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value)) {
    const values = value.map(cleanScalar).filter(Boolean);
    return values.length ? values.join(", ") : null;
  }
  if (typeof value === "object") {
    const record = asRecord(value);
    return cleanScalar(record.value ?? record.text ?? record.name ?? record.id);
  }
  return String(value);
}

/** Reads both the imported Amo object and the array shape returned by Amo API. */
export function getAmoField(raw: unknown, key: string): string | null {
  const record = asRecord(raw);
  const direct = record[key];
  if (direct !== undefined) return cleanScalar(direct);
  const fields = Array.isArray(raw)
    ? raw
    : Array.isArray(record.custom_fields_values)
      ? record.custom_fields_values
      : Array.isArray(record.values)
        ? record.values
        : [];
  const match = fields.find((item) => {
    const field = asRecord(item);
    return (
      field.field_name === key ||
      field.name === key ||
      field.key === key ||
      field.field_code === key
    );
  });
  if (!match) return null;
  const field = asRecord(match);
  return cleanScalar(field.values ?? field.value ?? field.text ?? field.enum_code);
}

export function valueToString(value: unknown): string | null {
  return cleanScalar(value);
}

export function normalizeOptions(value: unknown): { value: string; label: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((option) => {
      if (typeof option === "string" || typeof option === "number") {
        return { value: String(option), label: String(option) };
      }
      const item = asRecord(option);
      const raw = cleanScalar(item.value ?? item.id ?? item.code ?? item.label);
      const label = cleanScalar(item.label ?? item.name ?? item.value ?? item.id);
      return raw && label ? { value: raw, label } : null;
    })
    .filter((option): option is { value: string; label: string } => Boolean(option));
}

export function buildAttribution(
  utm: unknown,
  raw: unknown,
  customValues: Map<string, unknown>,
): Attribution {
  const stored = asRecord(utm);
  return Object.fromEntries(
    attributionKeys.map((key) => [
      key,
      attributionAliases[key].reduce<string | null>(
        (result, alias) =>
          result ?? cleanScalar(stored[alias]) ?? cleanScalar(customValues.get(alias)) ?? getAmoField(raw, alias),
        null,
      ),
    ]),
  ) as Attribution;
}
