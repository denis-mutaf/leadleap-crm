import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
type Env = Record<string, string | undefined>;
const PAGE_SIZE = 1000;
const ROOT = join(process.cwd(), ".scratch", "amo-cutover");
const dictionaryTables = [
  "stages",
  "projects",
  "tags",
  "lost_reasons",
  "task_types",
  "sources",
  "settings",
] as const;

function fail(message: string): never {
  throw new Error(message);
}
function parseEnv(text: string): Env {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => line && !line.trim().startsWith("#"))
      .flatMap((line) => {
        const i = line.indexOf("=");
        if (i < 1) return [];
        return [
          [
            line.slice(0, i).trim(),
            line
              .slice(i + 1)
              .trim()
              .replace(/^(['"])(.*)\1$/, "$2"),
          ],
        ];
      }),
  );
}
async function env(): Promise<Env> {
  return {
    ...parseEnv(await readFile(join(process.cwd(), ".env.local"), "utf8")),
    ...process.env,
  };
}
async function allRows(
  client: SupabaseClient,
  table: string,
  filters: Array<[string, string[]]> = [],
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = client
      .from(table)
      .select("*")
      .range(from, from + PAGE_SIZE - 1);
    for (const [column, values] of filters) query = query.in(column, values);
    const result = await query;
    if (result.error) fail(`${table}: ${result.error.message}`);
    rows.push(...((result.data ?? []) as Row[]));
    if ((result.data ?? []).length < PAGE_SIZE) return rows;
  }
}
function ids(rows: Row[]): string[] {
  return rows.map((row) => String(row.id));
}
function mergeRows(...groups: Row[][]): Row[] {
  const seen = new Set<string>();
  return groups.flat().filter((row) => {
    const id = String(row.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
function timestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
}
async function main() {
  const loaded = await env();
  const url = loaded.NEXT_PUBLIC_SUPABASE_URL || loaded.SUPABASE_URL;
  const key = loaded.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    fail(".env.local requires Supabase URL and SUPABASE_SERVICE_ROLE_KEY");
  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const demoDeals = await allRows(client, "deals");
  const selectedDeals = demoDeals.filter(
    (row) => row.amo_id === null || row.amo_id === undefined,
  );
  if (selectedDeals.length !== 35)
    fail(
      `expected exactly 35 demo deals with amo_id IS NULL, found ${selectedDeals.length}`,
    );
  const demoDealIds = ids(selectedDeals);
  const dealRows = selectedDeals;
  const contactIds = [
    ...new Set(
      selectedDeals
        .map((row) => row.contact_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  const tables: Record<string, Row[]> = { deals: dealRows };
  tables.contacts = await allRows(client, "contacts", [["id", contactIds]]);
  for (const table of ["contact_phones", "contact_channels", "contact_tags"])
    tables[table] = await allRows(client, table, [["contact_id", contactIds]]);
  for (const table of [
    "deal_projects",
    "deal_tags",
    "stage_transitions",
    "tasks",
    "notes",
    "calls",
    "notifications",
  ])
    tables[table] = await allRows(client, table, [["deal_id", demoDealIds]]);
  tables.notifications = mergeRows(
    tables.notifications,
    await allRows(client, "notifications", [["contact_id", contactIds]]),
  );
  tables.tasks = mergeRows(
    tables.tasks,
    await allRows(client, "tasks", [["contact_id", contactIds]]),
  );
  tables.notes = mergeRows(
    tables.notes,
    await allRows(client, "notes", [["contact_id", contactIds]]),
  );
  tables.calls = mergeRows(
    tables.calls,
    await allRows(client, "calls", [["contact_id", contactIds]]),
  );
  tables.conversations = await allRows(client, "conversations", [
    ["contact_id", contactIds],
  ]);
  const conversationIds = ids(tables.conversations);
  tables.messages = conversationIds.length
    ? await allRows(client, "messages", [["conversation_id", conversationIds]])
    : [];
  const demoTaskIds = ids(tables.tasks);
  tables.audit_log = await allRows(client, "audit_log", [
    ["entity_id", [...demoDealIds, ...contactIds, ...demoTaskIds]],
  ]);
  for (const table of dictionaryTables)
    tables[table] = await allRows(client, table);
  const backup = {
    created_at: new Date().toISOString(),
    demo_deal_ids: demoDealIds,
    tables,
  };
  await mkdir(ROOT, { recursive: true });
  const path = join(ROOT, `demo-backup-${timestamp()}.json`);
  const content = JSON.stringify(backup, null, 2) + "\n";
  await writeFile(path, content, { flag: "wx", mode: 0o600 });
  await chmod(path, 0o600);
  const counts = Object.fromEntries(
    Object.entries(tables).map(([table, rows]) => [table, rows.length]),
  );
  const sha256 = createHash("sha256").update(content).digest("hex");
  console.log(JSON.stringify({ counts, sha256, path }));
}
if (import.meta.url === `file://${process.argv[1]}`)
  main().catch((error) => {
    console.error(
      `ERROR: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    process.exitCode = 1;
  });
