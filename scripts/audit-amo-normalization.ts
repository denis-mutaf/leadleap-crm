import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

type Json = Record<string, unknown>;
type AmoField = Json & {
  field_id?: unknown;
  field_code?: unknown;
  field_name?: unknown;
  values?: unknown;
};
type AmoRecord = Json & {
  id?: unknown;
  _embedded?: unknown;
  custom_fields_values?: unknown;
  field_code?: unknown;
  field_name?: unknown;
  values?: unknown;
};
function asJson(value: unknown): Json {
  return value !== null && typeof value === "object" ? (value as Json) : {};
}
function asRecords(value: unknown): AmoRecord[] {
  return Array.isArray(value) ? (value.map(asJson) as AmoRecord[]) : [];
}
const ROOT = join(process.cwd(), ".scratch", "amo-dump");
const FULL = join(ROOT, "full");
const KNOWN_FIELDS = [
  807315, 807317, 807319, 807321, 807331, 792785, 792829, 827925, 827927,
  827929,
];

function fail(message: string): never {
  throw new Error(message);
}
function parseArgs() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      "Usage: audit-amo-normalization.ts [--help]\nRead-only audit of .scratch/amo-dump; no network or database access.",
    );
    process.exit(0);
  }
  if (args.length) fail(`unknown flag: ${args[0]}`);
}
function embedded(doc: Json, key: string, file: string): AmoRecord[] {
  const value = asJson(doc._embedded)[key];
  if (!Array.isArray(value)) fail(`${file}: missing _embedded.${key}[]`);
  return asRecords(value);
}
function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 8) return `+373${digits}`;
  if (digits.length === 9 && digits.startsWith("0"))
    return `+373${digits.slice(-8)}`;
  return `+${digits}`;
}
function readFieldValues(
  record: AmoRecord,
  fieldId: number,
): { present: boolean; values: unknown[] } {
  const fields = Array.isArray(record.custom_fields_values)
    ? (record.custom_fields_values as AmoField[])
    : [];
  const field = fields.find((item) => Number(item.field_id) === fieldId);
  return {
    present: Boolean(field),
    values: Array.isArray(field?.values)
      ? field.values.map((item) => asJson(item).value)
      : [],
  };
}
function shape(value: unknown): "empty" | "string" | "number" | "other" {
  if (value === null || value === undefined || value === "") return "empty";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  return "other";
}
async function main() {
  parseArgs();
  const files = (await readdir(FULL)).filter((file) => file.endsWith(".json"));
  const leads: AmoRecord[] = [],
    contacts: AmoRecord[] = [],
    tasks: AmoRecord[] = [],
    notes: AmoRecord[] = [];
  for (const file of files) {
    const doc = JSON.parse(await readFile(join(FULL, file), "utf8"));
    if (file.startsWith("leads-")) leads.push(...embedded(doc, "leads", file));
    else if (file.startsWith("contacts-"))
      contacts.push(...embedded(doc, "contacts", file));
    else if (file.startsWith("tasks-"))
      tasks.push(...embedded(doc, "tasks", file));
    else if (
      file.startsWith("lead-notes-") ||
      file.startsWith("contact-notes-")
    )
      notes.push(...embedded(doc, "notes", file));
  }
  const pipelines = JSON.parse(
    await readFile(join(ROOT, "pipelines.json"), "utf8"),
  );
  const users = JSON.parse(await readFile(join(ROOT, "users.json"), "utf8"));
  const lossReasons = JSON.parse(
    await readFile(join(ROOT, "loss-reasons.json"), "utf8"),
  );
  const statusIds = new Set<number>(
    pipelines._embedded.pipelines.flatMap((p: Json) =>
      (Array.isArray(asJson(p._embedded).statuses)
        ? (asJson(p._embedded).statuses as Json[])
        : []
      ).map((s) => Number(s.id)),
    ),
  );
  const userIds = new Set<number>(
    users._embedded.users.map((u: Json) => Number(u.id)),
  );
  const lossIds = new Set<number>(
    lossReasons._embedded.loss_reasons.map((r: Json) => Number(r.id)),
  );
  const links = { "0": 0, "1": 0, "2+": 0 };
  const unknownStatus = new Set<number>(),
    unknownResponsible = new Set<number>();
  let lostMissing = 0,
    lostUnknown = 0;
  for (const lead of leads) {
    const count = Array.isArray(asJson(lead._embedded).contacts)
      ? (asJson(lead._embedded).contacts as unknown[]).length
      : 0;
    links[count === 0 ? "0" : count === 1 ? "1" : "2+"] += 1;
    if (
      lead.status_id !== null &&
      lead.status_id !== undefined &&
      !statusIds.has(Number(lead.status_id))
    )
      unknownStatus.add(Number(lead.status_id));
    if (
      lead.responsible_user_id !== null &&
      lead.responsible_user_id !== undefined &&
      !userIds.has(Number(lead.responsible_user_id))
    )
      unknownResponsible.add(Number(lead.responsible_user_id));
    if (Number(lead.status_id) === 143) {
      if (lead.loss_reason_id === null || lead.loss_reason_id === undefined)
        lostMissing += 1;
      else if (!lossIds.has(Number(lead.loss_reason_id))) lostUnknown += 1;
    }
  }
  for (const record of contacts)
    if (
      record.responsible_user_id !== null &&
      record.responsible_user_id !== undefined &&
      !userIds.has(Number(record.responsible_user_id))
    )
      unknownResponsible.add(Number(record.responsible_user_id));
  const phoneOwner = new Map<string, number>();
  let phoneTotal = 0,
    phoneInvalid = 0,
    phoneDuplicateRows = 0;
  for (const contact of contacts)
    for (const field of Array.isArray(contact.custom_fields_values)
      ? (contact.custom_fields_values as AmoField[])
      : [])
      if (field.field_code === "PHONE" || field.field_name === "Телефон")
        for (const item of Array.isArray(field.values)
          ? (field.values as Json[])
          : []) {
          phoneTotal += 1;
          const normalized = normalizePhone(item.value);
          if (!normalized) {
            phoneInvalid += 1;
            continue;
          }
          const count = phoneOwner.get(normalized) ?? 0;
          if (count > 0) phoneDuplicateRows += 1;
          phoneOwner.set(normalized, count + 1);
        }
  const noteTypes: Record<string, number> = {};
  for (const note of notes)
    noteTypes[String(note.note_type ?? "<missing>")] =
      (noteTypes[String(note.note_type ?? "<missing>")] ?? 0) + 1;
  const taskEntityTypes: Record<string, number> = {};
  let emptyTaskText = 0;
  for (const task of tasks) {
    const type = String(task.entity_type ?? "<missing>");
    taskEntityTypes[type] = (taskEntityTypes[type] ?? 0) + 1;
    if (typeof task.text !== "string" || !task.text.trim()) emptyTaskText += 1;
  }
  const customFields: Record<
    string,
    {
      leads_present: number;
      leads_missing: number;
      contacts_present: number;
      contacts_missing: number;
      empty_values: number;
      value_shape_deviations: number;
    }
  > = {};
  for (const id of KNOWN_FIELDS) {
    let lp = 0,
      cp = 0,
      empty = 0,
      deviations = 0;
    for (const record of leads) {
      const field = readFieldValues(record, id);
      if (field.present) lp += 1;
      for (const value of field.values) {
        const kind = shape(value);
        if (kind === "empty") empty += 1;
        if (kind === "other") deviations += 1;
      }
    }
    for (const record of contacts) {
      const field = readFieldValues(record, id);
      if (field.present) cp += 1;
      for (const value of field.values) {
        const kind = shape(value);
        if (kind === "empty") empty += 1;
        if (kind === "other") deviations += 1;
      }
    }
    customFields[String(id)] = {
      leads_present: lp,
      leads_missing: leads.length - lp,
      contacts_present: cp,
      contacts_missing: contacts.length - cp,
      empty_values: empty,
      value_shape_deviations: deviations,
    };
  }
  console.log(
    JSON.stringify({
      counts: {
        leads: leads.length,
        contacts: contacts.length,
        tasks: tasks.length,
        notes: notes.length,
      },
      lead_contact_links: links,
      unknown_status_ids: [...unknownStatus].sort((a, b) => a - b),
      unknown_responsible_user_ids: [...unknownResponsible].sort(
        (a, b) => a - b,
      ),
      lost_leads: {
        loss_reason_id_missing: lostMissing,
        loss_reason_id_unknown: lostUnknown,
      },
      phones: {
        raw_values: phoneTotal,
        unique_normalized: phoneOwner.size,
        duplicate_rows: phoneDuplicateRows,
        invalid: phoneInvalid,
      },
      note_type: noteTypes,
      task_entity_type: taskEntityTypes,
      empty_task_text: emptyTaskText,
      known_custom_fields: customFields,
    }),
  );
}
main().catch((error) => {
  console.error(
    `ERROR: ${error instanceof Error ? error.message : "unknown error"}`,
  );
  process.exitCode = 1;
});
