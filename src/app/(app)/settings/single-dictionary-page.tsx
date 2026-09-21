import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DictionariesClient, type DictionaryData } from "./dictionaries/dictionaries-client";

export async function SingleDictionaryPage({ kind }: { kind: "tags" | "projects" }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role === "manager") redirect("/deals");
  if (profile.role === "builder") redirect("/reports");
  const db = await createClient();
  const table = kind === "tags" ? "tags" : "projects";
  const result = await db.from(table).select(kind === "tags" ? "id,name,is_active,merged_into" : "id,name,is_active,code").order("name");
  const counts = await db.rpc("dictionary_usage_counts");
  if (result.error || counts.error) {
    return <DictionariesClient initialData={[]} initialError="Данные справочника временно недоступны. Повторите попытку позже." role={profile.role} singleKey={kind} />;
  }
  const usage = new Map<string, number>();
  for (const item of (counts.data ?? []) as Array<{ dictionary_key: string; value_id: string; usage: number }>) usage.set(`${item.dictionary_key}:${item.value_id}`, Number(item.usage));
  const data: DictionaryData[] = [{ key: kind, label: kind === "tags" ? "Метки" : "Площадки", rows: (result.data ?? []).map((row) => ({ ...row, usage: usage.get(`${kind}:${row.id}`) ?? 0 })) }];
  return <DictionariesClient initialData={data} role={profile.role} singleKey={kind} />;
}
