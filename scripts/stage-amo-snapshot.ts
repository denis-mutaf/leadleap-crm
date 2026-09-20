import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

type Json = Record<string, unknown>;
type RecordRow = { entity_type: EntityType; amo_id: string; payload: unknown };
type EntityType =
  | "lead"
  | "contact"
  | "task"
  | "lead_note"
  | "contact_note"
  | "event"
  | "pipeline"
  | "user"
  | "lead_tag"
  | "contact_tag"
  | "loss_reason"
  | "lead_field"
  | "contact_field"
  | "unsorted";

const ROOT = join(process.cwd(), ".scratch", "amo-dump");
const FULL = join(ROOT, "full");
const BATCH_SIZE = 100;
const CONCURRENCY = 3;
const RETRIES = 4;
const rootFiles: Record<string, { entity: EntityType; key: string }> = {
  pipelines: { entity: "pipeline", key: "pipelines" },
  users: { entity: "user", key: "users" },
  "tags-leads": { entity: "lead_tag", key: "tags" },
  "tags-contacts": { entity: "contact_tag", key: "tags" },
  "loss-reasons": { entity: "loss_reason", key: "loss_reasons" },
  "fields-leads": { entity: "lead_field", key: "custom_fields" },
  "fields-contacts": { entity: "contact_field", key: "custom_fields" },
  unsorted: { entity: "unsorted", key: "unsorted" },
};
const fullFiles: Record<string, { entity: EntityType; key: string }> = {
  leads: { entity: "lead", key: "leads" },
  contacts: { entity: "contact", key: "contacts" },
  tasks: { entity: "task", key: "tasks" },
  "lead-notes": { entity: "lead_note", key: "notes" },
  "contact-notes": { entity: "contact_note", key: "notes" },
  events: { entity: "event", key: "events" },
};
const expectedPages: Record<string, number> = {
  leads: 23,
  contacts: 24,
  tasks: 7,
  "lead-notes": 27,
  "contact-notes": 30,
  events: 400,
};
const expectedRows: Record<EntityType, number> = {
  lead: 5749,
  contact: 5924,
  task: 1707,
  lead_note: 6680,
  contact_note: 7445,
  event: 39950,
  pipeline: 2,
  user: 5,
  lead_tag: 51,
  contact_tag: 2,
  loss_reason: 10,
  lead_field: 48,
  contact_field: 5,
  unsorted: 10,
};

function fail(message: string): never {
  throw new Error(message);
}
function parseArgs() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      "Usage: stage-amo-snapshot.ts [--write]\nDefault: validate and print a dry-run summary. --write enables staging upserts.",
    );
    process.exit(0);
  }
  const unknown = args.filter((arg) => arg !== "--write");
  if (unknown.length) fail(`unknown flag: ${unknown[0]}`);
  return { write: args.includes("--write") };
}
function parseEnvFile(text: string): Record<string, string> {
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
async function loadEnv() {
  try {
    return {
      ...parseEnvFile(
        await readFile(join(process.cwd(), ".env.local"), "utf8"),
      ),
      ...process.env,
    };
  } catch {
    return { ...process.env };
  }
}
function idOf(value: unknown, label: string): string {
  if (!value || typeof value !== "object") fail(`${label}: record has no id`);
  const id =
    (value as { id?: unknown; uid?: unknown }).id ??
    (value as { uid?: unknown }).uid;
  if (typeof id !== "string" && typeof id !== "number")
    fail(`${label}: id is not string/number`);
  return String(id);
}
function readRecords(doc: Json, key: string, label: string): unknown[] {
  const embedded = doc._embedded;
  if (
    !embedded ||
    typeof embedded !== "object" ||
    !Array.isArray((embedded as Json)[key])
  )
    fail(`${label}: missing _embedded.${key}[]`);
  return (embedded as Json)[key] as unknown[];
}
async function collect(): Promise<{
  rows: RecordRow[];
  manifest: string;
  files: number;
  rawEntities: number;
}> {
  const rows: RecordRow[] = [],
    manifestParts: string[] = [],
    seen = new Set<string>();
  let rawEntities = 0;
  const fullJson = (await readdir(FULL)).filter((f) => f.endsWith(".json"));
  const knownFull = new Set(
    Object.entries(expectedPages).flatMap(([prefix, n]) =>
      Array.from(
        { length: n },
        (_, i) => `${prefix}-${String(i + 1).padStart(4, "0")}.json`,
      ),
    ),
  );
  const unknownFull = fullJson.filter((file) => !knownFull.has(file));
  if (unknownFull.length) fail(`unknown JSON in full: ${unknownFull[0]}`);
  for (const [prefix, count] of Object.entries(expectedPages)) {
    const actual = fullJson
      .filter((file) => file.startsWith(`${prefix}-`))
      .sort();
    const expected = Array.from(
      { length: count },
      (_, i) => `${prefix}-${String(i + 1).padStart(4, "0")}.json`,
    );
    if (
      actual.length !== count ||
      actual.some((file, i) => file !== expected[i])
    )
      fail(`${prefix}: expected pages 0001..${String(count).padStart(4, "0")}`);
  }
  const files = [
    ...fullJson,
    ...Object.keys(rootFiles).map((f) => `${f}.json`),
  ];
  if (!files.length) fail("snapshot is empty");
  for (const file of files.sort()) {
    const isFull =
      file.includes("-") &&
      Object.keys(fullFiles).some((x) => file.startsWith(`${x}-`));
    const base = file.replace(/-\d{4}\.json$/, "").replace(/\.json$/, "");
    const spec = isFull
      ? Object.entries(fullFiles).find(([prefix]) =>
          file.startsWith(`${prefix}-`),
        )?.[1]
      : rootFiles[base];
    if (!spec) continue;
    const path = isFull ? join(FULL, file) : join(ROOT, file);
    const bytes = await readFile(path);
    const digest = createHash("sha256").update(bytes).digest("hex");
    manifestParts.push(`${relative(ROOT, path)} ${digest}`);
    let doc: Json;
    try {
      doc = JSON.parse(bytes.toString()) as Json;
    } catch {
      fail(`${file}: invalid JSON`);
    }
    for (const payload of readRecords(doc, spec.key, file)) {
      rawEntities += 1;
      const amo_id = idOf(payload, file);
      const unique = `${spec.entity}:${amo_id}`;
      if (seen.has(unique)) continue;
      seen.add(unique);
      rows.push({ entity_type: spec.entity, amo_id, payload });
    }
  }
  const byType = aggregate(rows);
  for (const [entity, expected] of Object.entries(expectedRows))
    if (byType[entity] !== expected)
      fail(
        `${entity}: expected ${expected} unique rows, got ${byType[entity] ?? 0}`,
      );
  const manifest = createHash("sha256")
    .update(manifestParts.join("\n"))
    .digest("hex");
  return { rows, manifest, files: manifestParts.length, rawEntities };
}
function aggregate(rows: RecordRow[]) {
  return Object.fromEntries(
    [...new Set(rows.map((r) => r.entity_type))]
      .sort()
      .map((t) => [t, rows.filter((r) => r.entity_type === t).length]),
  );
}
function printSummary(
  rows: RecordRow[],
  manifest: string,
  files: number,
  rawEntities: number,
) {
  console.log(
    JSON.stringify({
      files,
      entities: rawEntities,
      unique_ids: rows.length,
      by_type: aggregate(rows),
      manifest_sha256: manifest,
    }),
  );
}
async function request(
  url: string,
  init: RequestInit,
  attempt = 0,
): Promise<Response> {
  try {
    const response = await fetch(url, init);
    if (
      response.ok ||
      ![408, 429, 500, 502, 503, 504].includes(response.status) ||
      attempt >= RETRIES
    )
      return response;
  } catch (error) {
    if (attempt >= RETRIES) throw error;
  }
  await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
  return request(url, init, attempt + 1);
}
async function writeRows(
  rows: RecordRow[],
  env: Record<string, string | undefined>,
) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    fail("--write requires SUPABASE URL and SUPABASE_SERVICE_ROLE_KEY");
  const batches = Array.from(
    { length: Math.ceil(rows.length / BATCH_SIZE) },
    (_, i) => rows.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE),
  );
  let next = 0;
  async function worker() {
    while (next < batches.length) {
      const index = next++;
      const batch = batches[index];
      const response = await request(
        `${url}/rest/v1/amo_import_records?on_conflict=entity_type%2Camo_id`,
        {
          method: "POST",
          headers: {
            apikey: key!,
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates,return=minimal",
          },
          body: JSON.stringify(batch),
        },
      );
      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as {
          code?: string;
        };
        fail(
          `staging upsert batch ${index} failed: HTTP ${response.status}, code ${error.code ?? "unknown"}`,
        );
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker),
  );
  for (const entity of Object.keys(aggregate(rows))) {
    const response = await request(
      `${url}/rest/v1/amo_import_records?select=amo_id&entity_type=eq.${encodeURIComponent(entity)}`,
      {
        headers: {
          apikey: key!,
          Authorization: `Bearer ${key}`,
          Prefer: "count=exact",
        },
      },
    );
    if (!response.ok) fail(`staging count failed: HTTP ${response.status}`);
    const range = response.headers.get("content-range");
    const count = range?.split("/")[1];
    if (count !== String(aggregate(rows)[entity]))
      fail(`count mismatch for ${entity}`);
  }
}
async function main() {
  const args = parseArgs();
  const snapshot = await collect();
  printSummary(
    snapshot.rows,
    snapshot.manifest,
    snapshot.files,
    snapshot.rawEntities,
  );
  if (args.write) await writeRows(snapshot.rows, await loadEnv());
}
main().catch((error) => {
  console.error(
    `ERROR: ${error instanceof Error ? error.message : "unknown error"}`,
  );
  process.exitCode = 1;
});
