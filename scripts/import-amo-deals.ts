import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
type Lead = Row & {
  custom_fields_values?: Row[];
  _embedded?: { contacts?: Row[]; tags?: Row[] };
  [key: string]: unknown;
};
const BATCH = 100;
const reservationProjects: Record<number, string> = {
  77190714: "select",
  87572938: "next",
  78673114: "new_object",
  83982842: "d_tudor",
};
const fail = (message: string): never => {
  throw new Error(message);
};
const env = (text: string) =>
  Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const i = line.indexOf("=");
        return [
          line.slice(0, i).trim(),
          line
            .slice(i + 1)
            .trim()
            .replace(/^(['"])(.*)\1$/, "$2"),
        ];
      }),
  );
function args() {
  const values = process.argv.slice(2);
  if (values.includes("--help")) {
    console.log(
      "Usage: import-amo-deals.ts [--write]\nDefault: read-only preflight and aggregate report.",
    );
    process.exit(0);
  }
  if (values.some((value) => value !== "--write"))
    fail(`unknown flag: ${values.find((value) => value !== "--write")}`);
  return values.includes("--write");
}
async function client(): Promise<SupabaseClient> {
  const loaded = {
    ...env(await readFile(join(process.cwd(), ".env.local"), "utf8")),
    ...process.env,
  };
  const url = loaded.NEXT_PUBLIC_SUPABASE_URL || loaded.SUPABASE_URL;
  const key = loaded.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    fail("Supabase URL and SUPABASE_SERVICE_ROLE_KEY are required");
  return createClient(url!, key!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
async function page(
  db: SupabaseClient,
  table: string,
  filters: Array<[string, string | string[]]> = [],
): Promise<Row[]> {
  const rows: Row[] = [];
  const orderColumns =
    table === "amo_import_records"
      ? ["amo_id"]
      : table === "amo_stage_map"
        ? ["amo_status_id"]
        : table === "deal_contacts"
          ? ["deal_id", "contact_id"]
          : table === "deal_tags"
            ? ["deal_id", "tag_id"]
            : table === "deal_projects"
              ? ["deal_id", "project_id"]
              : ["id"];
  for (let from = 0; ; from += 1000) {
    let query = db
      .from(table)
      .select("*")
      .order(orderColumns[0], { ascending: true });
    for (const column of orderColumns.slice(1))
      query = query.order(column, { ascending: true });
    query = query.range(from, from + 999);
    for (const [column, value] of filters)
      query = Array.isArray(value)
        ? query.in(column, value)
        : query.eq(column, value);
    const result = await query;
    if (result.error) fail(`${table}: ${result.error.message}`);
    rows.push(...((result.data ?? []) as Row[]));
    if ((result.data ?? []).length < 1000) return rows;
  }
}
async function byIds(
  db: SupabaseClient,
  table: string,
  column: string,
  ids: string[],
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let i = 0; i < ids.length; i += 100)
    rows.push(...(await page(db, table, [[column, ids.slice(i, i + 100)]])));
  return rows;
}
async function upsert(
  db: SupabaseClient,
  table: string,
  rows: Row[],
  conflict: string,
) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const result = await db
      .from(table)
      .upsert(rows.slice(i, i + BATCH), { onConflict: conflict });
    if (result.error)
      fail(
        `${table} batch ${Math.floor(i / BATCH) + 1}: ${result.error.message}`,
      );
  }
}
function value(lead: Lead, id: number): unknown {
  const field = ((lead.custom_fields_values as Row[] | undefined) ?? []).find(
    (item: Row) => Number(item.field_id) === id,
  );
  const values = Array.isArray(field?.values) ? (field.values as Row[]) : [];
  return values[0]?.value;
}
function iso(value: unknown): string | null {
  return typeof value === "number"
    ? new Date(value * 1000).toISOString()
    : typeof value === "string"
      ? value
      : null;
}
function enumValue(
  raw: unknown,
  map: Record<string, string>,
  label: string,
): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (!map[String(raw)]) fail(`unknown ${label} value`);
  return map[String(raw)];
}
function rowsByAmo(rows: Row[]) {
  return new Map(rows.map((row) => [String(row.amo_id), row]));
}
async function main() {
  const write = args();
  const db = await client();
  const [
    leads,
    contacts,
    profiles,
    stageMap,
    tags,
    losses,
    fallback,
    projects,
    stages,
  ] = await Promise.all([
    page(db, "amo_import_records", [["entity_type", "lead"]]),
    page(db, "contacts"),
    page(db, "profiles"),
    page(db, "amo_stage_map"),
    page(db, "tags"),
    page(db, "lost_reasons"),
    page(db, "lost_reasons", [["name", "Не указана в Amo"]]),
    page(db, "projects", [
      ["code", ["select", "next", "new_object", "d_tudor"]],
    ]),
    page(db, "stages", [
      [
        "import_key",
        [
          "amo:stage:10",
          "amo:stage:20",
          "amo:stage:30",
          "amo:stage:40",
          "amo:stage:50",
          "amo:stage:60",
          "amo:stage:70",
          "amo:stage:80",
          "amo:stage:90",
          "amo:stage:100",
          "amo:stage:110",
          "amo:stage:120",
        ],
      ],
    ]),
  ]);
  if (leads.length !== 5749)
    fail(`expected 5749 staged leads, got ${leads.length}`);
  if (stageMap.length !== 16) fail("expected exactly 16 amo_stage_map rows");
  if (write) {
    if (contacts.filter((row) => row.amo_id !== null).length !== 5924)
      fail("expected exactly 5924 imported contact amo_ids");
    if (profiles.filter((row) => row.amo_id !== null).length !== 5)
      fail("expected exactly 5 imported profile amo_ids");
    if (tags.filter((row) => row.amo_id !== null).length !== 52)
      fail("expected exactly 52 tag IDs");
    if (
      losses.filter((row) => row.amo_id !== null).length !== 10 ||
      fallback.length !== 1
    )
      fail("expected 10 Amo loss reasons and one fallback");
  }
  const contactsByAmo = rowsByAmo(contacts),
    profilesByAmo = rowsByAmo(profiles),
    stagesById = new Map(stages.map((row) => [String(row.id), row])),
    tagsByAmo = rowsByAmo(tags),
    lossesByAmo = rowsByAmo(losses),
    projectByCode = new Map(projects.map((row) => [String(row.code), row]));
  const mapByStatus = new Map(
    stageMap.map((row) => [Number(row.amo_status_id), row]),
  );
  const dealRows: Row[] = [],
    syntheticRows: Row[] = [],
    linkRows: Row[] = [],
    projectRows: Row[] = [],
    tagRows: Row[] = [];
  let priceCount = 0,
    priceSum = 0;
  const seenDeals = new Set<string>();
  for (const staged of leads) {
    const lead = staged.payload as Lead;
    const id = Number(staged.amo_id);
    if (!Number.isInteger(id) || id <= 0 || seenDeals.has(String(id)))
      fail("invalid or duplicate lead ID");
    seenDeals.add(String(id));
    if (
      write &&
      lead.responsible_user_id &&
      !profilesByAmo.has(String(lead.responsible_user_id))
    )
      fail("unknown nonzero owner Amo ID");
    if (write && lead.created_by && !profilesByAmo.has(String(lead.created_by)))
      fail("unknown nonzero creator Amo ID");
    const statusId = Number(lead.status_id);
    const mapping = mapByStatus.get(statusId);
    if (!mapping) fail(`unknown status ID ${statusId}`);
    const stage = stagesById.get(String(mapping!.stage_id));
    if (!stage) fail("stage map points to unknown stage");
    const kind = String(stage!.kind);
    const status = kind === "lost" ? "lost" : kind === "won" ? "won" : "open";
    const embedded = Array.isArray(lead._embedded?.contacts)
      ? lead._embedded.contacts
      : [];
    const contactAmoIds = embedded.map((item: Row) => String(item.id));
    let contactId = contactsByAmo.get(contactAmoIds[0])?.id;
    if (!contactId) {
      contactId = undefined;
      const synthetic = { amo_id: -id, full_name: `Контакт сделки #${id}` };
      syntheticRows.push(synthetic);
      linkRows.push({
        deal_id: id,
        contact_amo_id: String(-id),
        is_primary: true,
      });
    }
    const lossId =
      lead.loss_reason_id === null || lead.loss_reason_id === undefined
        ? fallback[0].id
        : lossesByAmo.get(String(lead.loss_reason_id))?.id;
    if (status === "lost" && !lossId)
      fail("lost lead has no mapped loss reason");
    const roomsRaw = value(lead, 792785);
    const rooms =
      typeof roomsRaw === "string" && /^([0-9]|10)$/.test(roomsRaw.trim())
        ? Number(roomsRaw)
        : null;
    const row: Row = {
      amo_id: id,
      contact_id: contactId,
      owner_id:
        (lead.responsible_user_id
          ? profilesByAmo.get(String(lead.responsible_user_id))?.id
          : null) ?? null,
      stage_id: mapping!.stage_id,
      status,
      lost_reason_id: status === "lost" ? lossId : null,
      title: lead.name || `Сделка Amo #${id}`,
      amount:
        typeof lead.price === "number" && lead.price > 0 ? lead.price : null,
      created_at: iso(lead.created_at),
      updated_at: iso(lead.updated_at),
      closed_at: iso(lead.closed_at),
      created_by:
        (lead.created_by
          ? profilesByAmo.get(String(lead.created_by))?.id
          : null) ?? null,
      amo_pipeline_id: lead.pipeline_id ?? null,
      amo_status_id: statusId,
      amo_source_id: lead.source_id ?? null,
      amo_custom_fields: lead.custom_fields_values ?? [],
      rooms,
      rooms_text: rooms === null ? (roomsRaw ?? null) : null,
      residency_detail: value(lead, 807315) ?? null,
      residency: enumValue(
        value(lead, 807315),
        {
          "в Молдове": "local",
          "за границей": "diaspora",
          "Приезжает ( 30 дней)": "diaspora",
        },
        "residency",
      ),
      purpose: enumValue(
        value(lead, 807317),
        { "Для себя": "living", Инвестиция: "investment" },
        "purpose",
      ),
      construction_stage: value(lead, 807319) ?? null,
      payment: enumValue(
        value(lead, 807331),
        { Рассрочка: "installment", Полная: "cash", Ипотека: "mortgage" },
        "payment",
      ),
      purchase_timing_text: value(lead, 807321) ?? null,
      desired_area_text: value(lead, 792783) ?? null,
      desired_floor_text: value(lead, 807327) ?? null,
      wishes: value(lead, 807335) ?? null,
      down_payment_text: value(lead, 792829) ?? value(lead, 827927) ?? null,
      monthly_payment_text: value(lead, 827929) ?? null,
    };
    dealRows.push(row);
    for (const [index, contactAmoId] of contactAmoIds.entries()) {
      const target = contactsByAmo.get(contactAmoId);
      if (!target) fail("lead references unknown contact");
      linkRows.push({
        deal_id: id,
        contact_amo_id: contactAmoId,
        is_primary: index === 0,
      });
    }
    const projectCode = reservationProjects[statusId];
    if (projectCode && !projectByCode.has(projectCode))
      fail(`missing project ${projectCode}`);
    if (projectCode) projectRows.push({ deal_id: id, code: projectCode });
    const leadTags = Array.isArray(lead._embedded?.tags)
      ? lead._embedded.tags
      : [];
    for (const tag of leadTags) {
      if (!tagsByAmo.has(String(tag.id))) fail(`unknown tag ID ${tag.id}`);
      tagRows.push({ deal_id: id, tag_amo_id: String(tag.id) });
    }
    if (lead.price) {
      priceCount += 1;
      priceSum += Number(lead.price);
    }
  }
  if (tagRows.length !== 13341)
    fail(`expected 13341 deal tag links, got ${tagRows.length}`);
  if (
    new Set(tagRows.map((row) => `${row.deal_id}:${row.tag_amo_id}`)).size !==
    tagRows.length
  )
    fail("duplicate deal tag links");
  if (priceCount !== 185 || priceSum !== 7915168)
    fail(`price totals mismatch: ${priceCount}/${priceSum}`);
  if (!write) {
    console.log(
      JSON.stringify({
        staged_leads: leads.length,
        deals: dealRows.length,
        synthetic_contacts: syntheticRows.length,
        deal_contacts: linkRows.length,
        deal_projects: projectRows.length,
        deal_tags: tagRows.length,
        price_nonzero: priceCount,
        price_sum: priceSum,
        statuses: Object.fromEntries(
          [...new Set(dealRows.map((row) => row.status))].map((status) => [
            status,
            dealRows.filter((row) => row.status === status).length,
          ]),
        ),
      }),
    );
    return;
  }
  await upsert(db, "contacts", syntheticRows, "amo_id");
  const freshContacts = rowsByAmo(await page(db, "contacts"));
  for (const row of dealRows) {
    if (!row.contact_id) {
      const id = String(-Number(row.amo_id));
      row.contact_id = freshContacts.get(id)?.id;
    }
  }
  await upsert(db, "deals", dealRows, "amo_id");
  const imported = rowsByAmo(
    (await page(db, "deals")).filter((row) => row.amo_id !== null),
  );
  if (imported.size !== 5749) fail("post-write deal count mismatch");
  const contactsByKey = new Map(
    contacts.map((row) => [String(row.amo_id), row.id]),
  );
  const relations = linkRows.map((row) => ({
    deal_id: imported.get(String(row.deal_id))?.id,
    contact_id:
      contactsByKey.get(String(row.contact_amo_id)) ??
      freshContacts.get(String(row.contact_amo_id))?.id,
    is_primary: row.is_primary,
  }));
  if (relations.some((row) => !row.deal_id || !row.contact_id))
    fail("contact relation mapping failed");
  await upsert(db, "deal_contacts", relations, "deal_id,contact_id");
  await upsert(
    db,
    "deal_projects",
    projectRows
      .map((row) => ({
        deal_id: imported.get(String(row.deal_id))?.id,
        project_id: projectByCode.get(String(row.code))?.id,
      }))
      .filter((row) => row.deal_id && row.project_id),
    "deal_id,project_id",
  );
  await upsert(
    db,
    "deal_tags",
    tagRows
      .map((row) => ({
        deal_id: imported.get(String(row.deal_id))?.id,
        tag_id: tagsByAmo.get(String(row.tag_amo_id))?.id,
      }))
      .filter((row) => row.deal_id && row.tag_id),
    "deal_id,tag_id",
  );
  const finalDeals = (await page(db, "deals")).filter(
    (row) => row.amo_id !== null,
  );
  const finalDealIds = finalDeals.map((row) => String(row.id));
  const finalLinks = await byIds(db, "deal_contacts", "deal_id", finalDealIds);
  const finalTags = await byIds(db, "deal_tags", "deal_id", finalDealIds);
  const finalProjects = await byIds(
    db,
    "deal_projects",
    "deal_id",
    finalDealIds,
  );
  const finalStatuses = Object.fromEntries(
    ["lost", "won", "open"].map((status) => [
      status,
      finalDeals.filter((row) => row.status === status).length,
    ]),
  );
  const finalPriceRows = finalDeals.filter(
    (row) => typeof row.amount === "number" && row.amount > 0,
  );
  const finalPriceSum = finalPriceRows.reduce(
    (sum, row) => sum + Number(row.amount),
    0,
  );
  if (
    finalDeals.length !== 5749 ||
    finalLinks.length !== 5762 ||
    finalTags.length !== 13341 ||
    finalProjects.length !== 48 ||
    finalStatuses.lost !== 1958 ||
    finalStatuses.won !== 62 ||
    finalStatuses.open !== 3729 ||
    finalPriceRows.length !== 185 ||
    finalPriceSum !== 7915168
  )
    fail("post-write aggregate verification failed");
  console.log(
    JSON.stringify({
      deals: finalDeals.length,
      deal_contacts: finalLinks.length,
      deal_tags: finalTags.length,
      deal_projects: finalProjects.length,
      statuses: finalStatuses,
      price_nonzero: finalPriceRows.length,
      price_sum: finalPriceSum,
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
