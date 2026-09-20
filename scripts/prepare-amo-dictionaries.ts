import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Json = Record<string, unknown>;
const ROOT = join(process.cwd(), ".scratch", "amo-dump");
const STAGES = [
  [10, "Новая заявка — не дозвонились", [77190614, 77190686]],
  [20, "Сообщения", [82968662]],
  [30, "В работе", [77190690]],
  [40, "Перестал отвечать / не готов пока", [83356926]],
  [50, "Назначена встреча", [77190694]],
  [60, "Встреча проведена — изучает рынок", [77391742]],
  [70, "Встреча проведена — горячий", [77921038]],
  [80, "Заинтересован в новом объекте", [77928582]],
  [90, "Резервация", [77190714, 87572938, 78673114, 83982842]],
  [100, "Контроль оплаты", [77190718]],
  [110, "Договор", [142]],
  [120, "Отказ", [143]],
] as const;
const PROJECTS = [
  { code: "select", name: "Select" },
  { code: "next", name: "Next New Town" },
  { code: "new_object", name: "Новый объект" },
  { code: "d_tudor", name: "D. Tudor" },
];
const env = (text: string) =>
  Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((x) => x && !x.startsWith("#"))
      .map((x) => {
        const i = x.indexOf("=");
        return [
          x.slice(0, i).trim(),
          x
            .slice(i + 1)
            .trim()
            .replace(/^(['"])(.*)\1$/, "$2"),
        ];
      }),
  );
const fail = (message: string): never => {
  throw new Error(message);
};
const object = (value: unknown): Json =>
  value !== null && typeof value === "object" ? (value as Json) : {};
async function source(name: string): Promise<Json> {
  return JSON.parse(await readFile(join(ROOT, name), "utf8")) as Json;
}
async function fullLeads(): Promise<Json[]> {
  const rows: Json[] = [];
  for (const file of await readdir(join(ROOT, "full"))) {
    if (file.startsWith("leads-") && file.endsWith(".json")) {
      rows.push(
        ...records(
          JSON.parse(await readFile(join(ROOT, "full", file), "utf8")),
          "leads",
          file,
        ),
      );
    }
  }
  return rows;
}
function records(doc: Json, key: string, file: string): Json[] {
  const rows = object(doc._embedded)[key];
  if (!Array.isArray(rows)) fail(`${file}: missing _embedded.${key}[]`);
  return rows as Json[];
}
function parseArgs() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      "Usage: prepare-amo-dictionaries.ts [--write]\nDefault: validate contract and print dry-run aggregates.",
    );
    process.exit(0);
  }
  if (args.some((x) => x !== "--write"))
    fail(`unknown flag: ${args.find((x) => x !== "--write")}`);
  return args.includes("--write");
}
async function all(
  client: SupabaseClient,
  table: string,
  filters: Array<[string, string | string[]]> = [],
) {
  let rows: Json[] = [];
  for (let from = 0; ; from += 1000) {
    let query = client
      .from(table)
      .select("*")
      .range(from, from + 999);
    for (const [column, value] of filters)
      query = Array.isArray(value)
        ? query.in(column, value)
        : query.eq(column, value);
    const result = await query;
    if (result.error) fail(`${table}: ${result.error.message}`);
    rows = rows.concat((result.data ?? []) as Json[]);
    if ((result.data ?? []).length < 1000) return rows;
  }
}
async function main() {
  const write = parseArgs();
  const pipelines = await source("pipelines.json");
  const leadTags = records(
    await source("tags-leads.json"),
    "tags",
    "tags-leads.json",
  );
  const contactTags = records(
    await source("tags-contacts.json"),
    "tags",
    "tags-contacts.json",
  );
  const tagsById = new Map<string, Json>();
  for (const tag of [...leadTags, ...contactTags]) {
    const id = String(tag.id);
    const previous = tagsById.get(id);
    if (previous && String(previous.name) !== String(tag.name))
      fail(`Amo tag ${id} has inconsistent names`);
    tagsById.set(id, tag);
  }
  const tags = [...tagsById.values()];
  const losses = records(
    await source("loss-reasons.json"),
    "loss_reasons",
    "loss-reasons.json",
  );
  const stageRows = STAGES.map(([position, name]) => ({
    position,
    name,
    import_key: `amo:stage:${position}`,
    kind: position === 120 ? "lost" : position === 110 ? "won" : "open",
    requires_qualification: false,
    requires_next_step: false,
    is_active: false,
  }));
  const mapRows = STAGES.flatMap(([position, , statusIds]) =>
    statusIds.map((amo_status_id) => ({
      amo_status_id,
      import_key: `amo:stage:${position}`,
    })),
  );
  const leads = await fullLeads();
  const statusMap = new Map<number, string>(
    mapRows.map((row) => [row.amo_status_id, row.import_key]),
  );
  const uncovered = [
    ...new Set(leads.map((lead) => Number(lead.status_id))),
  ].filter((id) => !statusMap.has(id));
  if (uncovered.length)
    fail(`leads contain unmapped status IDs: ${uncovered.join(",")}`);
  const pipelineRows = records(pipelines, "pipelines", "pipelines.json");
  const amoStatuses = pipelineRows.flatMap((pipeline) =>
    Array.isArray(object(pipeline._embedded).statuses)
      ? (object(pipeline._embedded).statuses as Json[])
      : [],
  );
  const unsorted = amoStatuses.find((status) => Number(status.id) === 77190614);
  if (!unsorted || unsorted.name !== "Неразобранное")
    fail("Amo status 77190614 is not named Неразобранное");
  const sPrevanzare = pipelineRows.find(
    (pipeline) => pipeline.name === "Sprevanzare",
  );
  const sPrevanzareLeads = leads.filter(
    (lead) => String(lead.pipeline_id) === String(sPrevanzare?.id),
  ).length;
  if (sPrevanzareLeads !== 0)
    fail(`Sprevanzare contains ${sPrevanzareLeads} leads`);
  const duplicateIds = (rows: Json[]) =>
    rows.filter(
      (row, index) =>
        rows.findIndex((item) => String(item.id) === String(row.id)) !== index,
    );
  const duplicateNames = (rows: Json[]) =>
    rows.filter(
      (row, index) =>
        rows.findIndex((item) => String(item.name) === String(row.name)) !==
        index,
    );
  if (duplicateIds(tags).length || duplicateNames(tags).length)
    fail("Amo tags contain duplicate IDs or names");
  if (duplicateIds(losses).length || duplicateNames(losses).length)
    fail("Amo lost reasons contain duplicate IDs or names");
  const planned = {
    stages: stageRows.length,
    amo_status_map: mapRows.length,
    projects: PROJECTS.length,
    tags: tags.length,
    lost_reasons: losses.length + 1,
    task_types: 1,
    source_statuses_seen: Array.isArray(object(pipelines._embedded).pipelines)
      ? (object(pipelines._embedded).pipelines as Json[]).flatMap((p) =>
          Array.isArray(object(p._embedded).statuses)
            ? (object(p._embedded).statuses as unknown[])
            : [],
        ).length
      : 0,
    leads_checked: leads.length,
    unmapped_lead_statuses: uncovered.length,
    unsorted_status_77190614: 0,
    sprevanzare_leads: sPrevanzareLeads,
  };
  if (!write) {
    console.log(JSON.stringify(planned));
    return;
  }
  const loaded = {
    ...env(await readFile(join(process.cwd(), ".env.local"), "utf8")),
    ...process.env,
  };
  const url = loaded.NEXT_PUBLIC_SUPABASE_URL || loaded.SUPABASE_URL;
  const key = loaded.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    fail("--write requires Supabase URL and SUPABASE_SERVICE_ROLE_KEY");
  const client = createClient(url!, key!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const insertedStages = await client
    .from("stages")
    .upsert(stageRows, { onConflict: "import_key", ignoreDuplicates: true })
    .select("id,import_key");
  if (insertedStages.error) fail(insertedStages.error.message);
  const stages = await all(client, "stages", [
    ["import_key", stageRows.map((row) => row.import_key)],
  ]);
  const stageByKey = new Map(
    stages.map((row) => [String(row.import_key), row.id]),
  );
  const mapPayload = mapRows.map((row) => ({
    amo_status_id: row.amo_status_id,
    stage_id: stageByKey.get(row.import_key),
  }));
  if (mapPayload.some((row) => !row.stage_id))
    fail("stage map contains unknown stage");
  const mapped = await client
    .from("amo_stage_map")
    .upsert(mapPayload, { onConflict: "amo_status_id" });
  if (mapped.error) fail(mapped.error.message);
  for (const project of PROJECTS) {
    const result = await client
      .from("projects")
      .upsert(project, { onConflict: "code", ignoreDuplicates: true });
    if (result.error) fail(result.error.message);
  }
  for (const tag of tags) {
    const mapped = await client
      .from("tags")
      .select("id,name,amo_id")
      .eq("amo_id", tag.id);
    if (mapped.error) fail(mapped.error.message);
    const mappedRows = mapped.data ?? [];
    if (mappedRows.length > 1)
      fail(`tag Amo ID ${tag.id} is mapped more than once`);
    if (mappedRows.length === 1) {
      if (String(mappedRows[0].name) !== String(tag.name))
        fail(`tag Amo ID ${tag.id} has a conflicting CRM name`);
      continue;
    }
    const existing = await client
      .from("tags")
      .select("id,amo_id")
      .eq("name", tag.name)
      .limit(2);
    if (existing.error) fail(existing.error.message);
    const existingRows = existing.data ?? [];
    if (existingRows.length > 1) fail(`CRM tag name ${tag.name} is not unique`);
    if (existingRows.length === 1 && existingRows[0].amo_id !== null) {
      fail(`CRM tag name ${tag.name} already maps to another Amo ID`);
    }
    const result =
      existingRows.length === 1
        ? await client
            .from("tags")
            .update({ amo_id: tag.id })
            .eq("id", existingRows[0].id)
        : await client.from("tags").insert({ name: tag.name, amo_id: tag.id });
    if (result.error) fail(result.error.message);
  }
  for (const loss of losses) {
    const existing = await client
      .from("lost_reasons")
      .select("id")
      .eq("name", loss.name)
      .maybeSingle();
    if (existing.error) fail(existing.error.message);
    const result = existing.data
      ? await client
          .from("lost_reasons")
          .update({ amo_id: loss.id })
          .eq("id", existing.data.id)
      : await client
          .from("lost_reasons")
          .insert({ name: loss.name, amo_id: loss.id });
    if (result.error) fail(result.error.message);
  }
  const fallback = await client
    .from("lost_reasons")
    .select("id")
    .eq("name", "Не указана в Amo");
  if (fallback.error) fail(fallback.error.message);
  const fallbackRows = fallback.data ?? [];
  if (fallbackRows.length > 1) fail("fallback lost reason is not unique");
  if (fallbackRows.length === 0) {
    const insertedFallback = await client
      .from("lost_reasons")
      .insert({ name: "Не указана в Amo", position: 999 })
      .select("id");
    if (insertedFallback.error) fail(insertedFallback.error.message);
    if ((insertedFallback.data ?? []).length !== 1)
      fail("fallback lost reason insert did not create exactly one row");
  }
  const taskType = await client
    .from("task_types")
    .upsert(
      { code: "amo_contact", name: "Связаться", amo_id: 1 },
      { onConflict: "code" },
    );
  if (taskType.error) fail(taskType.error.message);
  const checkStages = await all(client, "stages", [
    ["import_key", stageRows.map((row) => row.import_key)],
  ]);
  const checkMap = await all(client, "amo_stage_map", [
    ["amo_status_id", mapRows.map((row) => String(row.amo_status_id))],
  ]);
  console.log(
    JSON.stringify({
      stages: checkStages.length,
      amo_status_map: checkMap.length,
      projects: (
        await all(client, "projects", [
          ["code", PROJECTS.map((row) => row.code)],
        ])
      ).length,
      tags: (
        await all(client, "tags", [
          ["amo_id", tags.map((row) => String(row.id))],
        ])
      ).length,
      lost_reasons: (
        await all(client, "lost_reasons", [
          ["amo_id", losses.map((row) => String(row.id))],
        ])
      ).length,
      task_types: (await all(client, "task_types", [["code", "amo_contact"]]))
        .length,
    }),
  );
}
if (import.meta.url === `file://${process.argv[1]}`)
  main().catch((error) => {
    console.error(
      `ERROR: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    process.exitCode = 1;
  });
