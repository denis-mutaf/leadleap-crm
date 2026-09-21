import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DictionariesClient, type DictionaryData } from "./dictionaries-client";

type UsageCount = { dictionary_key: string; value_id: string; usage: number };

export default async function DictionariesPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role === "manager") redirect("/deals");
  if (profile.role === "builder") redirect("/reports");
  const db = await createClient();
  const specs = [
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
  ] as const;
  let loaded: Awaited<ReturnType<typeof loadDictionaries>>;
  let counts: Awaited<ReturnType<typeof loadCounts>>;
  try {
    loaded = await loadDictionaries(db, specs);
    counts = await loadCounts(db);
  } catch {
    return (
      <DictionariesClient
        initialData={[]}
        initialError="Использования временно недоступны. Повторите попытку позже."
        role={profile.role}
      />
    );
  }
  const knownKeys = new Set<string>(specs.map((spec) => spec.key));
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    (counts.data ?? []).some(
      (item) =>
        !knownKeys.has(item.dictionary_key) ||
        !uuid.test(item.value_id) ||
        !Number.isSafeInteger(Number(item.usage)) ||
        Number(item.usage) < 0,
    )
  ) {
    return (
      <DictionariesClient
        initialData={[]}
        initialError="Данные справочников временно недоступны. Повторите попытку позже."
        role={profile.role}
      />
    );
  }
  const usage = new Map<string, number>();
  for (const item of counts.data ?? []) {
    const key = `${item.dictionary_key}:${item.value_id}`;
    usage.set(key, (usage.get(key) ?? 0) + Number(item.usage));
  }
  const data: DictionaryData[] = loaded.map(({ spec, values }) => ({
    key: spec.key,
    label: spec.label,
    rows: values.map((row) => ({
      ...row,
      usage: usage.get(`${spec.key}:${row.id}`) ?? 0,
    })),
  }));
  return <DictionariesClient initialData={data} role={profile.role} />;
}

async function loadDictionaries(
  db: Awaited<ReturnType<typeof createClient>>,
  specs: readonly {
    key: string;
    label: string;
    table: string;
    select: string;
  }[],
) {
  return Promise.all(
    specs.map(async (spec) => {
      const rows = await db.from(spec.table).select(spec.select).order("name");
      if (rows.error) throw new Error(`${spec.label}: ${rows.error.message}`);
      return {
        spec,
        values: (rows.data ?? []) as unknown as Array<
          Record<string, unknown> & { id: string; name: string }
        >,
      };
    }),
  );
}

async function loadCounts(
  db: Awaited<ReturnType<typeof createClient>>,
): Promise<{ data: UsageCount[] }> {
  const result = await db.rpc("dictionary_usage_counts");
  if (result.error) throw result.error;
  return { data: (result.data ?? []) as UsageCount[] };
}
