import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Json = Record<string, unknown>;
type Staged = { amo_id: string; payload: Json };
type CrmRow = { id: string; amo_id: number; contact_id?: string | null };
type NoteType = "common" | "call_in" | "call_out";
type Note = {
  amoId: number;
  source: "lead_note" | "contact_note";
  payload: Json;
  entityId: number;
  type: NoteType;
  createdAt: string;
  createdBy: number;
  params: Json;
  body: string;
};

const BATCH = 100;
const EXPECTED_NOTES = 14125;
const EXPECTED_CALLS = 7502;
const EXPECTED_DEALS = 5749;
const EXPECTED_CONTACTS = 5924;
const EXPECTED_PROFILES = 5;
const TYPES: Record<NoteType, number> = {
  common: 6623,
  call_in: 2245,
  call_out: 5257,
};

function fail(message: string): never {
  throw new Error(message);
}
function object(value: unknown): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}
function integer(value: unknown, label: string): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : NaN;
  if (!Number.isSafeInteger(n)) fail(`${label}: invalid value`);
  return n;
}
function iso(value: unknown): string {
  const n =
    typeof value === "number"
      ? value * 1000
      : typeof value === "string"
        ? Date.parse(value)
        : NaN;
  if (!Number.isFinite(n)) fail("invalid source timestamp");
  return new Date(n).toISOString();
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
function args(): boolean {
  const values = process.argv.slice(2);
  if (values.some((value) => value !== "--write")) fail("unknown flag");
  return values.includes("--write");
}
async function page(
  db: SupabaseClient,
  table: string,
  filters: Array<[string, string]> = [],
  order = "id",
): Promise<Json[]> {
  const rows: Json[] = [];
  for (let from = 0; ; from += 1000) {
    let query = db
      .from(table)
      .select("*")
      .order(order, { ascending: true })
      .range(from, from + 999);
    for (const [column, value] of filters) query = query.eq(column, value);
    const result = await query;
    if (result.error)
      fail(`${table} read failed:${result.error.code ?? "unknown"}`);
    rows.push(...((result.data ?? []) as Json[]));
    if ((result.data ?? []).length < 1000) return rows;
  }
}
async function staged(db: SupabaseClient, entity: string): Promise<Staged[]> {
  const rows = await page(
    db,
    "amo_import_records",
    [["entity_type", entity]],
    "amo_id",
  );
  return rows as unknown as Staged[];
}
function parseNotes(
  rows: Staged[],
  source: "lead_note" | "contact_note",
): Note[] {
  return rows.map((row) => {
    const payload = object(row.payload),
      params = object(payload.params),
      type = String(payload.note_type) as NoteType;
    if (type !== "common" && type !== "call_in" && type !== "call_out")
      fail("unknown note type");
    const rawBody = params.text;
    const body =
      type === "call_in"
        ? "Входящий звонок"
        : type === "call_out"
          ? "Исходящий звонок"
          : typeof rawBody === "string" && rawBody.trim()
            ? rawBody
            : fail("common note body is blank");
    const createdBy = integer(payload.created_by ?? 0, "created_by");
    return {
      amoId: integer(row.amo_id, "note amo_id"),
      source,
      payload,
      entityId: integer(payload.entity_id, "entity_id"),
      type,
      createdAt: iso(payload.created_at),
      createdBy,
      params,
      body,
    };
  });
}
function ids(rows: Staged[]): Set<number> {
  return new Set(rows.map((row) => integer(row.amo_id, "source entity id")));
}
function counts(notes: Note[]): Record<NoteType, number> {
  return {
    common: notes.filter((note) => note.type === "common").length,
    call_in: notes.filter((note) => note.type === "call_in").length,
    call_out: notes.filter((note) => note.type === "call_out").length,
  };
}
async function upsert(
  db: SupabaseClient,
  table: string,
  rows: Json[],
  conflict: string,
): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    const result = await db
      .from(table)
      .upsert(rows.slice(i, i + BATCH), { onConflict: conflict });
    if (result.error)
      fail(`${table} write failed:${result.error.code ?? "unknown"}`);
  }
}
function sourceAuthor(
  note: Note,
  profiles: Map<number, string>,
): string | null {
  if (note.createdBy === 0) return null;
  return profiles.get(note.createdBy) ?? fail("unknown note author");
}
function paramText(params: Json, key: string): string | null {
  return typeof params[key] === "string" ? (params[key] as string) : null;
}
function paramInt(params: Json, key: string): number | null {
  const value = params[key];
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : typeof value === "string" && /^\d+$/.test(value)
      ? Number(value)
      : null;
}
async function main() {
  const write = args(),
    env = await loadEnv(),
    url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL,
    key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail("missing Supabase service-role environment");
  const db = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const [leadRows, contactRows, leadSources, contactSources] =
    await Promise.all([
      staged(db, "lead_note"),
      staged(db, "contact_note"),
      staged(db, "lead"),
      staged(db, "contact"),
    ]);
  if (leadRows.length !== 6680 || contactRows.length !== 7445)
    fail("source note counts mismatch");
  const notes = [
    ...parseNotes(leadRows as Staged[], "lead_note"),
    ...parseNotes(contactRows as Staged[], "contact_note"),
  ];
  const noteIds = new Set(notes.map((note) => note.amoId));
  if (notes.length !== EXPECTED_NOTES || noteIds.size !== EXPECTED_NOTES)
    fail("note count or ID uniqueness mismatch");
  const typeCounts = counts(notes);
  if (
    typeCounts.common !== TYPES.common ||
    typeCounts.call_in !== TYPES.call_in ||
    typeCounts.call_out !== TYPES.call_out
  )
    fail("note type counts mismatch");
  const leadIds = ids(leadSources as Staged[]),
    contactIds = ids(contactSources as Staged[]);
  if (
    notes.some(
      (note) =>
        !(note.source === "lead_note" ? leadIds : contactIds).has(
          note.entityId,
        ),
    )
  )
    fail("note references unknown source entity");
  if (!write) {
    console.log(
      JSON.stringify({
        mode: "dry-run",
        notes: EXPECTED_NOTES,
        lead_notes: leadRows.length,
        contact_notes: contactRows.length,
        common: TYPES.common,
        call_in: TYPES.call_in,
        call_out: TYPES.call_out,
        calls: EXPECTED_CALLS,
      }),
    );
    return;
  }
  const [deals, contacts, profiles] = await Promise.all([
    page(db, "deals", [], "amo_id"),
    page(db, "contacts", [], "amo_id"),
    page(db, "profiles", [], "amo_id"),
  ]);
  const importedDeals = deals.filter((row) => row.amo_id !== null),
    importedContacts = contacts.filter((row) => row.amo_id !== null),
    importedProfiles = profiles.filter((row) => row.amo_id !== null);
  const syntheticContacts = importedContacts.filter(
    (row) => integer(row.amo_id, "contact amo_id") < 0,
  );
  if (
    importedDeals.length !== EXPECTED_DEALS ||
    importedContacts.filter((row) => integer(row.amo_id, "contact amo_id") > 0)
      .length !== EXPECTED_CONTACTS ||
    syntheticContacts.length !== 8 ||
    importedProfiles.length !== EXPECTED_PROFILES
  )
    fail("CRM import preflight counts mismatch");
  const dealByAmo = new Map(
      importedDeals.map((row) => [
        integer(row.amo_id, "deal amo_id"),
        row as unknown as CrmRow,
      ]),
    ),
    contactByAmo = new Map(
      importedContacts.map((row) => [
        integer(row.amo_id, "contact amo_id"),
        row as unknown as CrmRow,
      ]),
    ),
    profileByAmo = new Map(
      importedProfiles.map((row) => [
        integer(row.amo_id, "profile amo_id"),
        String(row.id),
      ]),
    );
  if (
    notes.some(
      (note) =>
        !(note.source === "lead_note" ? dealByAmo : contactByAmo).has(
          note.entityId,
        ),
    )
  )
    fail("note references missing imported CRM entity");
  for (const note of notes)
    if (note.createdBy !== 0 && !profileByAmo.has(note.createdBy))
      fail("unknown nonzero note author");
  const noteRows: Json[] = notes.map((note) => ({
    amo_id: note.amoId,
    deal_id:
      note.source === "lead_note" ? dealByAmo.get(note.entityId)?.id : null,
    contact_id:
      note.source === "contact_note"
        ? contactByAmo.get(note.entityId)?.id
        : null,
    author_id: sourceAuthor(note, profileByAmo),
    body: note.body,
    amo_note_type: note.type,
    amo_params: note.params,
    created_at: note.createdAt,
  }));
  await upsert(db, "notes", noteRows, "amo_id");
  const callNotes = notes.filter(
    (note) => note.type === "call_in" || note.type === "call_out",
  );
  const callRows: Json[] = callNotes.map((note) => {
    const contact =
        note.source === "contact_note"
          ? contactByAmo.get(note.entityId)
          : undefined,
      deal =
        note.source === "lead_note" ? dealByAmo.get(note.entityId) : undefined;
    const rawPhone = paramText(note.params, "phone");
    return {
      external_id: `amo-note:${note.amoId}`,
      direction: note.type === "call_in" ? "in" : "out",
      status: null,
      from_phone: note.type === "call_in" ? rawPhone : null,
      to_phone: note.type === "call_out" ? rawPhone : null,
      contact_id: contact?.id ?? deal?.contact_id ?? null,
      deal_id: deal?.id ?? null,
      user_id: sourceAuthor(note, profileByAmo),
      started_at: note.createdAt,
      duration_sec: paramInt(note.params, "duration"),
      recording_url: paramText(note.params, "link"),
      raw: note.payload,
    };
  });
  await upsert(db, "calls", callRows, "external_id");
  const finalNotes = await page(db, "notes", [], "amo_id"),
    finalCalls = await page(db, "calls", [], "external_id");
  const importedNotes = finalNotes.filter((row) => row.amo_id !== null),
    importedCalls = finalCalls.filter((row) =>
      String(row.external_id).startsWith("amo-note:"),
    );
  if (
    importedNotes.length !== EXPECTED_NOTES ||
    importedNotes.filter((row) => row.amo_note_type === "common").length !==
      TYPES.common ||
    importedNotes.filter((row) => row.amo_note_type === "call_in").length !==
      TYPES.call_in ||
    importedNotes.filter((row) => row.amo_note_type === "call_out").length !==
      TYPES.call_out ||
    importedCalls.length !== EXPECTED_CALLS ||
    importedCalls.filter(
      (row) => row.direction === "in" && row.from_phone !== null,
    ).length !== TYPES.call_in ||
    importedCalls.filter(
      (row) => row.direction === "out" && row.to_phone !== null,
    ).length !== TYPES.call_out ||
    importedCalls.filter(
      (row) => row.direction === "in" && row.from_phone === null,
    ).length !== 0 ||
    importedCalls.filter(
      (row) => row.direction === "out" && row.to_phone === null,
    ).length !== 0
  )
    fail("final imported note/call counts mismatch");
  console.log(
    JSON.stringify({
      mode: "write",
      notes: EXPECTED_NOTES,
      calls: EXPECTED_CALLS,
      common: TYPES.common,
      call_in: TYPES.call_in,
      call_out: TYPES.call_out,
    }),
  );
}
main().catch((error: unknown) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : "unknown"}`);
  process.exitCode = 1;
});
