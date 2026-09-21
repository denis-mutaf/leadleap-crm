import type { SupabaseClient } from "@supabase/supabase-js";
import { toClientCall, type CallDbRow, type CallRow } from "./types";

// Догрузка имён, которых нет в основном select: сотрудники, авторы заметок
// (у calls два FK в profiles — хинт PostgREST хрупок) и имена этапов сделок.
// Работает и для списка, и для одиночной панели.
export async function hydrateCalls(
  supabase: SupabaseClient,
  rows: CallDbRow[],
): Promise<CallRow[]> {
  const calls = rows.map(toClientCall);
  const userIds = [...new Set(rows.flatMap((r) => [r.user_id, r.note_by]).filter(Boolean))] as string[];
  const stageIds = [...new Set(rows.map((r) => r.deal?.stage_id).filter(Boolean))] as string[];

  let names = new Map<string, string>();
  if (userIds.length) {
    const { data } = await supabase.from("profiles").select("id,full_name").in("id", userIds);
    names = new Map((data ?? []).map((p) => [p.id as string, (p.full_name as string) ?? "сотрудник"]));
  }
  let stages = new Map<string, string>();
  if (stageIds.length) {
    const { data } = await supabase.from("stages").select("id,name").in("id", stageIds);
    stages = new Map((data ?? []).map((s) => [s.id as string, (s.name as string) ?? ""]));
  }

  return calls.map((call, index) => ({
    ...call,
    employee: rows[index].user_id
      ? { id: rows[index].user_id as string, full_name: names.get(rows[index].user_id as string) ?? "сотрудник" }
      : null,
    note_author: rows[index].note_by
      ? { id: rows[index].note_by as string, full_name: names.get(rows[index].note_by as string) ?? "сотрудник" }
      : null,
    deal_stage: call.deal?.stage_id ? (stages.get(call.deal.stage_id) ?? null) : null,
  }));
}
