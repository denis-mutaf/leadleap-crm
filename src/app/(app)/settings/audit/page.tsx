import { Filter, History } from "lucide-react";
import Form from "next/form";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import styles from "../settings.module.css";

type Search = { person?: string; from?: string; to?: string; system?: string };

// Журнал читают люди, а не разработчик: имя таблицы и имя колонки заменяются
// тем, как это называется на экранах.
const ENTITY_NAMES: Record<string, string> = {
  contacts: "Контакт",
  deals: "Сделка",
  tasks: "Задача",
  notes: "Примечание",
  calls: "Звонок",
  stages: "Этап",
  tags: "Метка",
  projects: "Площадка",
  sources: "Источник",
  profiles: "Пользователь",
};
const FIELD_NAMES: Record<string, string> = {
  last_activity_at: "последняя активность",
  utm: "атрибуция",
  meta_campaign_id: "кампания",
  owner_id: "ответственный",
  stage_id: "этап",
  status: "статус",
  full_name: "имя",
  budget: "бюджет",
  object_text: "объект",
  source_id: "источник",
  deleted_at: "удаление",
};

// Переход «этап в самого себя» — запись импорта о том, где сделка завелась.
function transitionText(
  row: { deal_id: string | null; from_stage_id: string | null; to_stage_id: string },
  stageNames: Map<string, string>,
  dealNames: Map<string, string | null>,
): string {
  const who = (row.deal_id && dealNames.get(row.deal_id)) || null;
  const to = stageNames.get(row.to_stage_id) ?? "этап";
  const from = row.from_stage_id ? stageNames.get(row.from_stage_id) : null;
  const body = from && from !== to ? `${from} → ${to}` : `заведена на этапе «${to}»`;
  return who ? `${who}: ${body}` : body;
}

function changeSummary(changes: unknown): string {
  if (!changes || typeof changes !== "object") return "";
  const keys = Object.keys(changes as Record<string, unknown>);
  if (keys.length === 0) return "";
  const named = keys.map((key) => FIELD_NAMES[key] ?? key);
  return named.length > 3
    ? ` — ${named.slice(0, 3).join(", ")} и ещё ${named.length - 3}`
    : ` — ${named.join(", ")}`;
}
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
  // Массовые правки из импорта и миграций идут без автора и забивают журнал
  // тысячами одинаковых строк. По умолчанию показываем то, что сделали люди.
  const showSystem = params.system === "1";
  const auditQuery = db.from("audit_log").select("id,entity,action,actor_id,created_at,changes").order("created_at", { ascending: false }).limit(80);
  if (actorId) auditQuery.eq("actor_id", actorId);
  else if (!showSystem) auditQuery.not("actor_id", "is", null);
  if (params.from) auditQuery.gte("created_at", `${params.from}T00:00:00.000Z`);
  if (params.to) auditQuery.lte("created_at", `${params.to}T23:59:59.999Z`);
  const [transitions, audit] = await Promise.all([transitionsQuery, auditQuery]);
  if (transitions.error) throw new Error(`Переходы: ${transitions.error.message}`);
  if (audit.error) throw new Error(`Журнал: ${audit.error.message}`);
  const actorNames = new Map((profiles.data ?? []).map((row) => [row.id, row.full_name]));
  const stageIds = new Set<string>();
  for (const row of transitions.data ?? []) { if (row.from_stage_id) stageIds.add(row.from_stage_id); stageIds.add(row.to_stage_id); }
  const dealIds = [...new Set((transitions.data ?? []).map((row) => row.deal_id).filter(Boolean))];
  const [stageResult, dealResult] = await Promise.all([
    stageIds.size ? db.from("stages").select("id,name").in("id", [...stageIds]) : Promise.resolve({ data: [], error: null }),
    dealIds.length ? db.from("deals").select("id,contact:contacts!deals_contact_id_fkey(full_name)").in("id", dealIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (stageResult.error) throw new Error(`Этапы журнала: ${stageResult.error.message}`);
  if (dealResult.error) throw new Error(`Сделки журнала: ${dealResult.error.message}`);
  const stageNames = new Map((stageResult.data ?? []).map((row) => [row.id, row.name]));
  // Без имени клиента строка «Переход: В работе → Отказ» ничего не говорит:
  // непонятно, чья это сделка.
  const dealNames = new Map(
    ((dealResult.data ?? []) as Array<{ id: string; contact: { full_name: string } | { full_name: string }[] | null }>).map((row) => [
      row.id,
      (Array.isArray(row.contact) ? row.contact[0]?.full_name : row.contact?.full_name) ?? null,
    ]),
  );
  const events: EventRow[] = [
    ...(transitions.data ?? []).map((row) => ({ id: `transition-${row.id}`, at: row.changed_at, actor: actorNames.get(row.changed_by ?? "") ?? "Система", text: transitionText(row, stageNames, dealNames) })),
    ...(audit.data ?? []).map((row) => ({ id: `audit-${row.id}`, at: row.created_at, actor: actorNames.get(row.actor_id ?? "") ?? "Система", text: `${row.action === "update" ? "Изменение" : row.action === "delete" ? "Удаление" : "Создание"}: ${ENTITY_NAMES[row.entity] ?? row.entity}${changeSummary(row.changes)}` })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 100);
  return <div className={styles.page}>
    <header className={styles.header}><div><h1>Журнал изменений</h1><p className={styles.subtitle}>Переходы этапов и изменения записей</p></div></header>
    <Form className={styles.auditFilters} action="/settings/audit" key={`${actorId ?? ""}|${params.from ?? ""}|${params.to ?? ""}|${showSystem}`}><Filter size={15} aria-hidden="true" /><select name="person" defaultValue={actorId ?? ""}><option value="">Все люди</option>{(profiles.data ?? []).map((row) => <option key={row.id} value={row.id}>{row.full_name}</option>)}</select><input type="date" name="from" defaultValue={params.from ?? ""} aria-label="С даты" /><input type="date" name="to" defaultValue={params.to ?? ""} aria-label="По дату" /><label className={styles.auditSystem}><input type="checkbox" name="system" value="1" defaultChecked={showSystem} /> Системные</label><button className={styles.filterButton}>Показать</button></Form>
    <div className={styles.auditList}>{events.length ? events.map((event) => <article className={styles.auditRow} key={event.id}><History size={15} /><div><strong>{event.text}</strong><p>{event.actor} · {new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Chisinau" }).format(new Date(event.at))}</p></div></article>) : <p className={styles.auditEmpty}>{showSystem ? "За выбранный период изменений нет." : "Люди пока ничего не меняли за этот период. Массовые правки импорта показывает галочка «Системные»."}</p>}</div>
  </div>;
}
