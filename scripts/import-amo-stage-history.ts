import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Json = Record<string, unknown>;
type Staged = { amo_id: string; payload: Json };
type Deal = { id: string; amo_id: number };
type Profile = { id: string; amo_id: number };
type Stage = { id: string; kind: "open" | "won" | "lost" };
type MapRow = { amo_status_id: number; stage_id: string };
type Transition = {
  eventId: string;
  dealAmoId: number;
  fromStatusId: number;
  toStatusId: number;
  createdBy: number;
  changedAt: string;
};

const PAGE = 1000;
const BATCH = 100;
const EXPECTED_EVENTS = 39950;
const EXPECTED_STATUS_EVENTS = 2348;
const EXPECTED_TRANSITIONS = 2323;
const EXPECTED_DEALS = 5749;
const EXPECTED_PROFILES = 5;
const EXPECTED_MAP = 16;

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
function timestamp(value: unknown): string {
  const n =
    typeof value === "number"
      ? value * 1000
      : typeof value === "string"
        ? Date.parse(value)
        : NaN;
  if (!Number.isFinite(n)) fail("invalid source timestamp");
  return new Date(n).toISOString();
}
function epoch(value: unknown): number {
  const result = typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(result)) fail("invalid transition timestamp");
  return result;
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
async function env(): Promise<Record<string, string | undefined>> {
  try {
    return {
      ...envFile(await readFile(join(process.cwd(), ".env.local"), "utf8")),
      ...process.env,
    };
  } catch {
    return process.env;
  }
}
function writeMode(): boolean {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--write")) fail("unknown flag");
  return args.includes("--write");
}
async function page(
  db: SupabaseClient,
  table: string,
  filters: Array<[string, string]> = [],
  order = "id",
): Promise<Json[]> {
  const rows: Json[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = db
      .from(table)
      .select("*")
      .order(order, { ascending: true })
      .range(from, from + PAGE - 1);
    for (const [column, value] of filters) query = query.eq(column, value);
    const result = await query;
    if (result.error)
      fail(`${table} read failed:${result.error.code ?? "unknown"}`);
    rows.push(...((result.data ?? []) as Json[]));
    if ((result.data ?? []).length < PAGE) return rows;
  }
}
async function staged(db: SupabaseClient, entity: string): Promise<Staged[]> {
  return (await page(
    db,
    "amo_import_records",
    [["entity_type", entity]],
    "amo_id",
  )) as unknown as Staged[];
}
function arrayObject(value: unknown): Json[] {
  return Array.isArray(value) ? value.map(object) : [];
}
function parseEvents(rows: Staged[]): Transition[] {
  const result: Transition[] = [];
  for (const row of rows) {
    const payload = object(row.payload);
    if (payload.type !== "lead_status_changed") continue;
    const before = arrayObject(payload.value_before)[0],
      after = arrayObject(payload.value_after)[0];
    result.push({
      eventId: String(row.amo_id),
      dealAmoId: integer(payload.entity_id, "event entity_id"),
      fromStatusId: integer(
        object(before).lead_status && object(object(before).lead_status).id,
        "before status",
      ),
      toStatusId: integer(
        object(after).lead_status && object(object(after).lead_status).id,
        "after status",
      ),
      createdBy: integer(payload.created_by ?? 0, "event created_by"),
      changedAt: timestamp(payload.created_at),
    });
  }
  return result;
}
async function upsert(db: SupabaseClient, rows: Json[]): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    const result = await db
      .from("stage_transitions")
      .upsert(rows.slice(i, i + BATCH), { onConflict: "amo_event_id" });
    if (result.error)
      fail(`stage transition write failed:${result.error.code ?? "unknown"}`);
  }
}
async function main() {
  const write = writeMode(),
    loaded = await env(),
    url = loaded.NEXT_PUBLIC_SUPABASE_URL ?? loaded.SUPABASE_URL,
    key = loaded.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail("missing Supabase service-role environment");
  const db = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const [events, leads] = await Promise.all([
    staged(db, "event"),
    staged(db, "lead"),
  ]);
  if (events.length !== EXPECTED_EVENTS) fail("event source count mismatch");
  const transitions = parseEvents(events),
    eventIds = new Set(transitions.map((row) => row.eventId));
  if (
    transitions.length !== EXPECTED_STATUS_EVENTS ||
    eventIds.size !== EXPECTED_STATUS_EVENTS
  )
    fail("status event count or ID uniqueness mismatch");
  const leadIds = new Set(
      leads.map((row) => integer(row.amo_id, "lead source ID")),
    ),
    orphanCount = transitions.filter(
      (row) => !leadIds.has(row.dealAmoId),
    ).length;
  if (orphanCount !== 25) fail("unexpected orphan event count");
  const attachable = transitions.filter((row) => leadIds.has(row.dealAmoId));
  if (attachable.length !== EXPECTED_TRANSITIONS)
    fail("attachable transition count mismatch");
  if (!write) {
    console.log(
      JSON.stringify({
        mode: "dry-run",
        events: EXPECTED_EVENTS,
        status_events: EXPECTED_STATUS_EVENTS,
        attachable_transitions: EXPECTED_TRANSITIONS,
        orphan_events: orphanCount,
      }),
    );
    return;
  }
  const [dealsRaw, profilesRaw, mapRaw, stagesRaw] = await Promise.all([
    page(db, "deals", [], "amo_id"),
    page(db, "profiles", [], "amo_id"),
    page(db, "amo_stage_map", [], "amo_status_id"),
    page(db, "stages"),
  ]);
  const deals = dealsRaw.filter(
      (row) => row.amo_id !== null,
    ) as unknown as Deal[],
    profiles = profilesRaw.filter(
      (row) => row.amo_id !== null,
    ) as unknown as Profile[],
    maps = mapRaw as unknown as MapRow[],
    stages = stagesRaw as unknown as Stage[];
  if (
    deals.length !== EXPECTED_DEALS ||
    profiles.length !== EXPECTED_PROFILES ||
    maps.length !== EXPECTED_MAP
  )
    fail("stage history preflight counts mismatch");
  const dealByAmo = new Map(
      deals.map((deal) => [integer(deal.amo_id, "deal amo_id"), deal.id]),
    ),
    profileByAmo = new Map(
      profiles.map((profile) => [
        integer(profile.amo_id, "profile amo_id"),
        profile.id,
      ]),
    ),
    mapByStatus = new Map(
      maps.map((row) => [
        integer(row.amo_status_id, "map status ID"),
        row.stage_id,
      ]),
    ),
    stageById = new Map(stages.map((stage) => [stage.id, stage.kind]));
  if (
    attachable.some(
      (row) =>
        !dealByAmo.has(row.dealAmoId) ||
        !mapByStatus.has(row.fromStatusId) ||
        !mapByStatus.has(row.toStatusId) ||
        !stageById.has(mapByStatus.get(row.fromStatusId)!) ||
        !stageById.has(mapByStatus.get(row.toStatusId)!) ||
        (row.createdBy !== 0 && !profileByAmo.has(row.createdBy)),
    )
  )
    fail("stage history references unknown imported ID");
  const rows: Json[] = attachable.map((row) => {
    const fromStage = mapByStatus.get(row.fromStatusId)!,
      toStage = mapByStatus.get(row.toStatusId)!;
    return {
      amo_event_id: row.eventId,
      deal_id: dealByAmo.get(row.dealAmoId),
      from_stage_id: fromStage,
      to_stage_id: toStage,
      from_status: stageById.get(fromStage),
      to_status: stageById.get(toStage),
      changed_by: row.createdBy === 0 ? null : profileByAmo.get(row.createdBy),
      changed_at: row.changedAt,
    };
  });
  await upsert(db, rows);
  const final = await page(db, "stage_transitions", [], "amo_event_id"),
    imported = final.filter((row) => typeof row.amo_event_id === "string");
  const finalByEvent = new Map(
    imported.map((row) => [String(row.amo_event_id), row]),
  );
  if (
    imported.length !== EXPECTED_TRANSITIONS ||
    new Set(imported.map((row) => String(row.amo_event_id))).size !==
      EXPECTED_TRANSITIONS ||
    imported.some(
      (row) =>
        !row.deal_id ||
        !row.from_stage_id ||
        !row.to_stage_id ||
        !row.changed_at,
    ) ||
    attachable.some((source) => {
      const row = finalByEvent.get(source.eventId);
      if (!row || epoch(row.changed_at) !== epoch(source.changedAt))
        return true;
      const fromStage = mapByStatus.get(source.fromStatusId);
      const toStage = mapByStatus.get(source.toStatusId);
      if (
        row.from_stage_id !== fromStage ||
        row.to_stage_id !== toStage ||
        row.from_status !== stageById.get(fromStage ?? "") ||
        row.to_status !== stageById.get(toStage ?? "")
      )
        return true;
      const expectedAuthor =
        source.createdBy === 0 ? null : profileByAmo.get(source.createdBy);
      return (row.changed_by ?? null) !== expectedAuthor;
    })
  )
    fail("final stage history verification failed");
  console.log(
    JSON.stringify({
      mode: "write",
      transitions: EXPECTED_TRANSITIONS,
      orphan_events: orphanCount,
    }),
  );
}
main().catch((error: unknown) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : "unknown"}`);
  process.exitCode = 1;
});
