import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Json = Record<string, unknown>;
type ContactRow = { amo_id: string; payload: Json };
type Contact = { id: string; amo_id: number; full_name: string };
type Phone = {
  contact_id: string;
  ordinal: number;
  raw_phone: string;
  normalized_phone: string | null;
  label: string | null;
};
type Email = {
  contact_id: string;
  ordinal: number;
  email: string;
  label: string | null;
};
type TagLink = { contact_id: string; tag_id: string };

const EXPECTED = 5924;
const PAGE = 500;
const PHONE_FIELD = 792691;
const EMAIL_FIELD = 792693;

function fail(message: string): never {
  throw new Error(message);
}
function object(value: unknown): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}
function number(value: unknown, label: string): number {
  const result =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : NaN;
  if (!Number.isSafeInteger(result)) fail(`${label}: invalid id`);
  return result;
}
function normalizePhone(raw: string | null): string | null {
  if (raw === null) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 8) return `+373${digits}`;
  if (digits.length === 9 && digits.startsWith("0"))
    return `+373${digits.slice(1)}`;
  return `+${digits}`;
}
function envFile(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => line && !line.trim().startsWith("#"))
      .flatMap((line) => {
        const i = line.indexOf("=");
        return i > 0
          ? [
              [
                line.slice(0, i).trim(),
                line
                  .slice(i + 1)
                  .trim()
                  .replace(/^(?:'|\")(.*)(?:'|\")$/, "$1"),
              ],
            ]
          : [];
      }),
  );
}
async function loadEnv(): Promise<Record<string, string | undefined>> {
  try {
    return {
      ...envFile(await readFile(join(process.cwd(), ".env.local"), "utf8")),
      ...process.env,
    };
  } catch {
    return process.env;
  }
}
function payloadFields(payload: Json, fieldId: number): Json[] {
  const fields = Array.isArray(payload.custom_fields_values)
    ? payload.custom_fields_values
    : [];
  const field = fields
    .map(object)
    .find((item) => Number(item.field_id) === fieldId);
  return Array.isArray(field?.values) ? field.values.map(object) : [];
}
function sourceTime(value: unknown): string | undefined {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return new Date(n < 100000000000 ? n * 1000 : n).toISOString();
}
async function readRows(db: SupabaseClient): Promise<ContactRow[]> {
  const rows: ContactRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from("amo_import_records")
      .select("amo_id,payload")
      .eq("entity_type", "contact")
      .order("amo_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) fail(`source read failed: ${error.code ?? "unknown"}`);
    const page = (data ?? []) as unknown as ContactRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
    from += PAGE;
  }
  if (rows.length !== EXPECTED)
    fail(`expected ${EXPECTED} contacts, got ${rows.length}`);
  const ids = new Set<number>();
  for (const row of rows) {
    const id = number(row.amo_id, "contact amo_id");
    if (ids.has(id)) fail("duplicate contact amo_id");
    ids.add(id);
    if (
      !object(row.payload).id ||
      number(object(row.payload).id, "payload id") !== id
    )
      fail("contact id mismatch");
  }
  return rows;
}
function build(rows: ContactRow[]) {
  const contacts: Array<Record<string, unknown>> = [],
    phones: Phone[] = [],
    emails: Email[] = [],
    tags: Array<{ amo_id: number; contactAmoId: number }> = [];
  let rawPhones = 0,
    rawEmails = 0,
    blankNames = 0,
    invalidPhones = 0,
    tagLinks = 0;
  for (const row of rows) {
    const payload = object(row.payload),
      amoId = number(row.amo_id, "contact amo_id");
    const name =
      typeof payload.name === "string" && payload.name.trim()
        ? payload.name.trim()
        : `Контакт #${amoId}`;
    if (name.startsWith("Контакт #")) blankNames++;
    const record: Record<string, unknown> = {
      amo_id: amoId,
      full_name: name,
      amo_custom_fields: Array.isArray(payload.custom_fields_values)
        ? payload.custom_fields_values
        : null,
    };
    const created = sourceTime(payload.created_at),
      updated = sourceTime(payload.updated_at);
    if (created) record.created_at = created;
    if (updated) record.updated_at = updated;
    contacts.push(record);
    for (const [ordinal, field] of payloadFields(
      payload,
      PHONE_FIELD,
    ).entries()) {
      if (typeof field.value !== "string") fail("phone value is not text");
      const normalized = normalizePhone(field.value);
      phones.push({
        contact_id: row.amo_id,
        ordinal,
        raw_phone: field.value,
        normalized_phone: normalized,
        label: typeof field.enum_code === "string" ? field.enum_code : null,
      });
      rawPhones++;
      if (normalized === null) invalidPhones++;
    }
    for (const [ordinal, field] of payloadFields(
      payload,
      EMAIL_FIELD,
    ).entries()) {
      if (typeof field.value !== "string") fail("email value is not text");
      emails.push({
        contact_id: row.amo_id,
        ordinal,
        email: field.value,
        label: typeof field.enum_code === "string" ? field.enum_code : null,
      });
      rawEmails++;
    }
    const embedded = object(payload._embedded),
      embeddedTags = Array.isArray(embedded.tags) ? embedded.tags : [];
    for (const item of embeddedTags) {
      tags.push({
        amo_id: number(object(item).id, "tag id"),
        contactAmoId: amoId,
      });
      tagLinks++;
    }
  }
  return {
    contacts,
    phones,
    emails,
    tags,
    rawPhones,
    rawEmails,
    blankNames,
    invalidPhones,
    tagLinks,
  };
}
async function upsertBatches(
  db: SupabaseClient,
  table: string,
  rows: unknown[],
  onConflict: string,
  ignoreDuplicates = false,
): Promise<void> {
  for (let i = 0; i < rows.length; i += PAGE) {
    const { error } = await db
      .from(table)
      .upsert(rows.slice(i, i + PAGE), { onConflict, ignoreDuplicates });
    if (error) fail(`${table} batch failed: ${error.code ?? "unknown"}`);
  }
}
async function readImportedContacts(
  db: SupabaseClient,
  expectedIds: Set<number>,
): Promise<Contact[]> {
  const contacts: Contact[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from("contacts")
      .select("id,amo_id,full_name")
      .not("amo_id", "is", null)
      .order("amo_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) fail(`contact verification failed: ${error.code ?? "unknown"}`);
    const page = (data ?? []) as unknown as Contact[];
    contacts.push(...page);
    if (page.length < PAGE) break;
    from += PAGE;
  }
  if (contacts.length !== EXPECTED)
    fail("contact verification failed: count mismatch");
  const actualIds = new Set(contacts.map((contact) => contact.amo_id));
  if (
    actualIds.size !== EXPECTED ||
    actualIds.size !== expectedIds.size ||
    [...expectedIds].some((id) => !actualIds.has(id))
  )
    fail("contact verification failed: id mismatch");
  return contacts;
}
async function exactCount(db: SupabaseClient, table: string): Promise<number> {
  const { count, error } = await db
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error || count === null) fail(`${table} verification failed`);
  return count;
}
async function main() {
  const args = process.argv.slice(2),
    write = args.includes("--write");
  if (args.some((arg) => arg !== "--write")) fail("unknown flag");
  const env = await loadEnv(),
    url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL,
    key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail("missing Supabase service-role environment");
  const db = createClient(url, key),
    rows = await readRows(db),
    built = build(rows);
  if (!write) {
    console.log(
      JSON.stringify({
        mode: "dry-run",
        contacts: rows.length,
        raw_phones: built.rawPhones,
        invalid_phones: built.invalidPhones,
        raw_emails: built.rawEmails,
        blank_names: built.blankNames,
        contact_tag_links: built.tagLinks,
      }),
    );
    return;
  }
  await upsertBatches(db, "contacts", built.contacts, "amo_id");
  const byAmo = new Map(
    (
      await readImportedContacts(
        db,
        new Set(built.contacts.map((row) => Number(row.amo_id))),
      )
    ).map((contact) => [contact.amo_id, contact.id]),
  );
  const imported = built.phones.map((phone) => ({
    ...phone,
    contact_id:
      byAmo.get(number(phone.contact_id, "phone contact")) ??
      fail("unknown contact"),
  }));
  const importedEmails = built.emails.map((email) => ({
    ...email,
    contact_id:
      byAmo.get(number(email.contact_id, "email contact")) ??
      fail("unknown contact"),
  }));
  await upsertBatches(
    db,
    "imported_contact_phones",
    imported,
    "contact_id,ordinal",
  );
  await upsertBatches(
    db,
    "contact_emails",
    importedEmails,
    "contact_id,ordinal",
  );
  const owners = new Map<string, { contact_id: string; amo_id: number }>();
  for (const phone of built.phones)
    if (phone.normalized_phone) {
      const amoId = number(phone.contact_id, "phone contact"),
        current = owners.get(phone.normalized_phone);
      if (!current || amoId < current.amo_id)
        owners.set(phone.normalized_phone, {
          contact_id: byAmo.get(amoId) ?? fail("unknown contact"),
          amo_id: amoId,
        });
    }
  await upsertBatches(
    db,
    "contact_phones",
    [...owners].map(([phone, owner]) => ({
      contact_id: owner.contact_id,
      phone,
      is_primary: false,
    })),
    "phone",
    true,
  );
  const { data: dictionary, error: dictError } = await db
    .from("tags")
    .select("id,amo_id")
    .in("amo_id", [...new Set(built.tags.map((tag) => tag.amo_id))]);
  if (dictError)
    fail(`tag dictionary read failed: ${dictError.code ?? "unknown"}`);
  const tagByAmo = new Map(
    (dictionary ?? []).map((tag) => [Number(tag.amo_id), String(tag.id)]),
  );
  const links: TagLink[] = built.tags.map((tag) => ({
    contact_id: byAmo.get(tag.contactAmoId) ?? fail("unknown contact"),
    tag_id: tagByAmo.get(tag.amo_id) ?? fail("unknown tag"),
  }));
  await upsertBatches(db, "contact_tags", links, "contact_id,tag_id");
  if ((await exactCount(db, "imported_contact_phones")) !== built.rawPhones)
    fail("imported phone count verification failed");
  if ((await exactCount(db, "contact_emails")) !== built.rawEmails)
    fail("contact email count verification failed");
  if ((await exactCount(db, "contact_tags")) !== built.tagLinks)
    fail("contact tag count verification failed");
  if ((await exactCount(db, "contacts")) < EXPECTED)
    fail("final contact count verification failed");
  console.log(
    JSON.stringify({
      mode: "write",
      contacts: EXPECTED,
      raw_phones: built.rawPhones,
      raw_emails: built.rawEmails,
      contact_tag_links: built.tagLinks,
    }),
  );
}
main().catch((error: unknown) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : "unknown"}`);
  process.exitCode = 1;
});
