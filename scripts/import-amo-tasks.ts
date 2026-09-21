import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Json = Record<string, unknown>;
type DbRow = Json & { id?: string; amo_id?: number | string | null };
type Source = { amo_id: string; payload: Json };
type TaskInsert = Json;
const EXPECTED = 1707;
const PAGE = 500;
const BATCH = 100;

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
  if (!Number.isSafeInteger(result) || result <= 0)
    fail(`${label}: invalid id`);
  return result;
}
function epoch(value: unknown, label: string): string {
  const n =
    typeof value === "number" ||
    (typeof value === "string" && value.trim() !== "")
      ? Number(value)
      : NaN;
  if (!Number.isFinite(n)) fail(`${label}: invalid timestamp`);
  return new Date(n < 100000000000 ? n * 1000 : n).toISOString();
}
function nonzeroId(value: unknown, label: string): number | null {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    Number(value) === 0
  )
    return null;
  return number(value, label);
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
                  .replace(/^(?:'|")(.*)(?:'|")$/, "$1"),
              ],
            ]
          : [];
      }),
  );
}
async function client(): Promise<SupabaseClient> {
  let file: Record<string, string> = {};
  try {
    file = envFile(await readFile(join(process.cwd(), ".env.local"), "utf8"));
  } catch {
    /* environment may provide all values */
  }
  const values = { ...file, ...process.env };
  const url = values.NEXT_PUBLIC_SUPABASE_URL ?? values.SUPABASE_URL;
  const key = values.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail("Supabase URL and service role key are required");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
async function readSource(db: SupabaseClient): Promise<Source[]> {
  const rows: Source[] = [];
  for (let from = 0; ; from += PAGE) {
    const result = await db
      .from("amo_import_records")
      .select("amo_id,payload")
      .eq("entity_type", "task")
      .order("amo_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (result.error) fail("source read failed");
    const page = (result.data ?? []) as unknown as Source[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  if (rows.length !== EXPECTED)
    fail(`expected ${EXPECTED} task source rows, got ${rows.length}`);
  const ids = new Set<number>();
  for (const row of rows) {
    const id = number(row.amo_id, "task amo_id");
    if (ids.has(id)) fail("duplicate task amo_id");
    ids.add(id);
    object(row.payload);
  }
  return rows;
}
async function all(
  db: SupabaseClient,
  table: string,
  select: string,
): Promise<DbRow[]> {
  const rows: DbRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const result = await db
      .from(table)
      .select(select)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (result.error) fail(`${table} read failed`);
    const page = (result.data ?? []) as unknown as DbRow[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}
async function upsert(db: SupabaseClient, rows: TaskInsert[]): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    const result = await db
      .from("tasks")
      .upsert(rows.slice(i, i + BATCH), { onConflict: "amo_id" });
    if (result.error)
      fail(
        `task upsert failed: batch ${Math.floor(i / BATCH) + 1}, code ${result.error.code ?? "unknown"}`,
      );
  }
}
async function auditEntriesForTasks(
  db: SupabaseClient,
  taskIds: string[],
): Promise<number> {
  let count = 0;
  for (let i = 0; i < taskIds.length; i += BATCH) {
    const result = await db
      .from("audit_log")
      .select("entity_id")
      .eq("entity", "tasks")
      .in("entity_id", taskIds.slice(i, i + BATCH));
    if (result.error) fail("task audit read failed");
    count += (result.data ?? []).length;
  }
  return count;
}
function args(): boolean {
  const values = process.argv.slice(2);
  if (values.includes("--help")) {
    console.log("Usage: import-amo-tasks.ts [--write]");
    process.exit(0);
  }
  if (values.some((value) => value !== "--write")) fail("unknown flag");
  return values.includes("--write");
}
async function main(): Promise<void> {
  const write = args();
  const db = await client();
  const source = await readSource(db);
  const [deals, contacts, profiles, types] = await Promise.all([
    all(db, "deals", "id,amo_id"),
    all(db, "contacts", "id,amo_id"),
    all(db, "profiles", "id,amo_id"),
    all(db, "task_types", "id,amo_id"),
  ]);
  if (write) {
    if (
      deals.filter((row) => row.amo_id !== null && row.amo_id !== undefined)
        .length !== 5749
    )
      fail("expected 5749 imported deals");
    const positiveContacts = contacts.filter(
      (row) => row.amo_id != null && Number(row.amo_id) > 0,
    );
    const syntheticContacts = contacts.filter(
      (row) => row.amo_id != null && Number(row.amo_id) < 0,
    );
    if (positiveContacts.length !== 5924)
      fail("expected 5924 positive imported contacts");
    if (syntheticContacts.length !== 8) fail("expected 8 synthetic contacts");
    if (
      profiles.filter((row) => row.amo_id !== null && row.amo_id !== undefined)
        .length !== 5
    )
      fail("expected 5 imported profiles");
  }
  const dealByAmo = new Map(
    deals.filter((r) => r.amo_id != null).map((r) => [String(r.amo_id), r.id]),
  );
  const contactByAmo = new Map(
    contacts
      .filter((r) => r.amo_id != null && Number(r.amo_id) > 0)
      .map((r) => [String(r.amo_id), r.id]),
  );
  const profileByAmo = new Map(
    profiles
      .filter((r) => r.amo_id != null)
      .map((r) => [String(r.amo_id), r.id]),
  );
  const type = types.find((r) => Number(r.amo_id) === 1);
  if (write && !type?.id) fail("task_types.amo_id=1 is missing");
  const rows: TaskInsert[] = [];
  let done = 0,
    unresolved = 0,
    leads = 0,
    linkedContacts = 0,
    linkedDeals = 0,
    blankTitles = 0;
  for (const record of source) {
    const payload = object(record.payload),
      taskId = number(record.amo_id, "task amo_id");
    const entityIdRaw = payload.entity_id ?? payload.entityId;
    const entityId =
      entityIdRaw === null || entityIdRaw === undefined || entityIdRaw === ""
        ? null
        : number(entityIdRaw, "entity_id");
    const entityTypeRaw = payload.entity_type ?? payload.entityType;
    const sourceType =
      entityTypeRaw === "contacts" || entityTypeRaw === "contact"
        ? "contacts"
        : entityTypeRaw === "leads" || entityTypeRaw === "lead"
          ? "leads"
          : null;
    if (entityTypeRaw !== null && entityTypeRaw !== undefined && !sourceType)
      fail("task has invalid entity_type");
    const dealId =
      sourceType === "leads" && entityId !== null
        ? (dealByAmo.get(String(entityId)) ?? null)
        : null;
    const contactId =
      sourceType === "contacts" && entityId !== null
        ? (contactByAmo.get(String(entityId)) ?? null)
        : null;
    const isUnresolved = dealId === null && contactId === null;
    const title =
      typeof payload.text === "string" && payload.text.trim()
        ? payload.text
        : "Связаться";
    if (title === "Связаться") blankTitles++;
    const responsible = nonzeroId(
      payload.responsible_user_id,
      "responsible_user_id",
    );
    const creator = nonzeroId(payload.created_by, "created_by");
    if (write && responsible !== null && !profileByAmo.has(String(responsible)))
      fail("unknown responsible user");
    if (write && creator !== null && !profileByAmo.has(String(creator)))
      fail("unknown creator user");
    if (isUnresolved) unresolved++;
    else if (dealId) {
      linkedDeals++;
      leads++;
    } else linkedContacts++;
    const completed =
      payload.is_completed === true || Number(payload.is_completed) === 1;
    if (completed) done++;
    rows.push({
      amo_id: taskId,
      deal_id: dealId,
      contact_id: contactId,
      amo_entity_type: isUnresolved ? "unresolved" : sourceType,
      amo_entity_id: entityId,
      title,
      due_at: epoch(payload.complete_till, "complete_till"),
      created_at: epoch(payload.created_at, "created_at"),
      assignee_id:
        responsible === null
          ? null
          : (profileByAmo.get(String(responsible)) ?? null),
      created_by:
        creator === null ? null : (profileByAmo.get(String(creator)) ?? null),
      type_id: type?.id ?? null,
      is_auto: false,
      amo_result: payload.result ?? null,
      // Amo has no completed_at in the snapshot; updated_at is the inferred completion time.
      done_at: completed ? epoch(payload.updated_at, "updated_at") : null,
      done_by: null,
    });
  }
  if (
    done !== 1569 ||
    unresolved !== 1 ||
    linkedDeals !== 1698 ||
    linkedContacts !== 8 ||
    leads !== 1698
  )
    fail("source task aggregate mismatch");
  if (write) {
    await upsert(db, rows);
    const imported = (
      await all(
        db,
        "tasks",
        "id,amo_id,deal_id,contact_id,amo_entity_type,amo_entity_id,done_at",
      )
    ).filter((r) => r.amo_id != null);
    const ids = new Set(source.map((r) => String(r.amo_id)));
    if (
      imported.length !== EXPECTED ||
      imported.some((r) => !ids.has(String(r.amo_id)))
    )
      fail("imported task ID verification failed");
    const taskIds = imported
      .map((row) => row.id)
      .filter((id): id is string => typeof id === "string");
    if (
      taskIds.length !== EXPECTED ||
      taskIds.some(
        (id) =>
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            id,
          ),
      )
    )
      fail("imported task UUID verification failed");
    if ((await auditEntriesForTasks(db, taskIds)) !== 0)
      fail("imported tasks have audit_log entries");
    if (
      imported.filter((r) => r.done_at !== null && r.done_at !== undefined)
        .length !== 1569
    )
      fail("final done count mismatch");
  }
  console.log(
    JSON.stringify({
      mode: write ? "write" : "dry-run",
      source_tasks: EXPECTED,
      completed: done,
      leads: 1698,
      contacts: 8,
      unresolved,
      blank_titles: blankTitles,
      writes: write ? EXPECTED : 0,
    }),
  );
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "task import failed");
  process.exitCode = 1;
});
