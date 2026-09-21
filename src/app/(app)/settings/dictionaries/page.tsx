import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DictionariesClient, type DictionaryData } from "./dictionaries-client";

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
) {
  const result: R[] = [];
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      result[i] = await task(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return result;
}

export default async function DictionariesPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role === "manager") redirect("/deals");
  if (profile.role === "builder") redirect("/reports");
  const db = await createClient();
  const specs = [
    {
      key: "tags",
      label: "Метки",
      table: "tags",
      relation: "deal_tags",
      foreign: "tag_id",
      select: "id, name, is_active, merged_into",
    },
    {
      key: "sources",
      label: "Источники",
      table: "sources",
      relation: "deals",
      foreign: "source_id",
      select: "id, name, is_active, code",
    },
    {
      key: "task_types",
      label: "Типы задач",
      table: "task_types",
      relation: "tasks",
      foreign: "type_id",
      select: "id, name, is_active, code",
    },
    {
      key: "lost_reasons",
      label: "Причины отказа",
      table: "lost_reasons",
      relation: "deals",
      foreign: "lost_reason_id",
      select: "id, name, is_active, position",
    },
    {
      key: "projects",
      label: "Площадки",
      table: "projects",
      relation: "deal_projects",
      foreign: "project_id",
      select: "id, name, is_active, code",
    },
  ] as const;
  const data: DictionaryData[] = [];
  for (const spec of specs) {
    const rows = await db.from(spec.table).select(spec.select).order("name");
    if (rows.error) throw new Error(`${spec.label}: ${rows.error.message}`);
    const values = rows.data ?? [];
    const counts = await mapWithLimit(values, 4, async (row) => {
      const count = await db
        .from(spec.relation)
        .select(
          spec.key === "tags"
            ? "tag_id"
            : spec.key === "projects"
              ? "project_id"
              : "id",
          { count: "exact", head: true },
        )
        .eq(spec.foreign, row.id);
      if (count.error) throw new Error(`${spec.label}: ${count.error.message}`);
      if (spec.key !== "tags") {
        if (count.count === null)
          throw new Error(
            `${spec.label}: не удалось получить точное число использований`,
          );
        return [row.id, count.count] as const;
      }
      const contacts = await db
        .from("contact_tags")
        .select("tag_id", { count: "exact", head: true })
        .eq("tag_id", row.id);
      if (contacts.error)
        throw new Error(`${spec.label}: ${contacts.error.message}`);
      if (count.count === null || contacts.count === null)
        throw new Error(
          `${spec.label}: не удалось получить точное число использований`,
        );
      return [row.id, count.count + contacts.count] as const;
    });
    data.push({
      key: spec.key,
      label: spec.label,
      rows: values.map((row) => ({
        ...row,
        usage: counts.find(([id]) => id === row.id)?.[1] ?? 0,
      })),
    });
  }
  return <DictionariesClient initialData={data} role={profile.role} />;
}
