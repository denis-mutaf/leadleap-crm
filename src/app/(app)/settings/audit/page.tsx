import { Filter, History } from "lucide-react";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import styles from "../settings.module.css";

type Search = { person?: string; from?: string; to?: string };
type EventRow = { id: string; at: string; actor: string; text: string };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const params = await searchParams;
  const db = await createClient();
  const profiles = await db.from("profiles").select("id,full_name").order("full_name");
  const actorId = params.person && profiles.data?.some((row) => row.id === params.person) ? params.person : undefined;
  const transitionsQuery = db.from("stage_transitions").select("id,deal_id,from_stage_id,to_stage_id,changed_by,changed_at").order("changed_at", { ascending: false }).limit(80);
  if (actorId) transitionsQuery.eq("changed_by", actorId);
  if (params.from) transitionsQuery.gte("changed_at", `${params.from}T00:00:00.000Z`);
  if (params.to) transitionsQuery.lte("changed_at", `${params.to}T23:59:59.999Z`);
  const auditQuery = db.from("audit_log").select("id,entity,action,actor_id,created_at,changes").order("created_at", { ascending: false }).limit(80);
  if (actorId) auditQuery.eq("actor_id", actorId);
  if (params.from) auditQuery.gte("created_at", `${params.from}T00:00:00.000Z`);
  if (params.to) auditQuery.lte("created_at", `${params.to}T23:59:59.999Z`);
  const [transitions, audit] = await Promise.all([transitionsQuery, auditQuery]);
  if (transitions.error) throw new Error(`Переходы: ${transitions.error.message}`);
  if (audit.error) throw new Error(`Журнал: ${audit.error.message}`);
  const actorNames = new Map((profiles.data ?? []).map((row) => [row.id, row.full_name]));
  const stageIds = new Set<string>();
  for (const row of transitions.data ?? []) { if (row.from_stage_id) stageIds.add(row.from_stage_id); stageIds.add(row.to_stage_id); }
  const stageResult = stageIds.size ? await db.from("stages").select("id,name").in("id", [...stageIds]) : { data: [], error: null };
  if (stageResult.error) throw new Error(`Этапы журнала: ${stageResult.error.message}`);
  const stageNames = new Map((stageResult.data ?? []).map((row) => [row.id, row.name]));
  const events: EventRow[] = [
    ...(transitions.data ?? []).map((row) => ({ id: `transition-${row.id}`, at: row.changed_at, actor: actorNames.get(row.changed_by ?? "") ?? "Система", text: `Переход: ${stageNames.get(row.from_stage_id ?? "") ?? "Новая сделка"} → ${stageNames.get(row.to_stage_id) ?? "этап"}` })),
    ...(audit.data ?? []).map((row) => ({ id: `audit-${row.id}`, at: row.created_at, actor: actorNames.get(row.actor_id ?? "") ?? "Система", text: `${row.action === "update" ? "Изменение" : row.action === "delete" ? "Удаление" : "Создание"}: ${row.entity}` })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 100);
  return <div className={styles.page}>
    <header className={styles.header}><div><h1>Журнал изменений</h1><p className={styles.subtitle}>Переходы этапов и изменения записей</p></div></header>
    <form className={styles.auditFilters} method="get"><Filter size={15} aria-hidden="true" /><select name="person" defaultValue={actorId ?? ""}><option value="">Все люди</option>{(profiles.data ?? []).map((row) => <option key={row.id} value={row.id}>{row.full_name}</option>)}</select><input type="date" name="from" defaultValue={params.from ?? ""} aria-label="С даты" /><input type="date" name="to" defaultValue={params.to ?? ""} aria-label="По дату" /><button className={styles.filterButton}>Показать</button></form>
    <div className={styles.auditList}>{events.length ? events.map((event) => <article className={styles.auditRow} key={event.id}><History size={15} /><div><strong>{event.text}</strong><p>{event.actor} · {new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.at))}</p></div></article>) : <p className={styles.auditEmpty}>За выбранный период изменений нет.</p>}</div>
  </div>;
}
