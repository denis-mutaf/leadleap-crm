import { Filter, History } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { changeText, describeChanges, isFeedField } from "@/lib/deal-changes";
import { DateField } from "@/components/crm/date-field";
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
const ACTION_NAMES: Record<string, string> = {
  insert: "Создание",
  update: "Изменение",
  delete: "Удаление",
  soft_delete: "Удаление в корзину",
  restore: "Восстановление из корзины",
};
const FIELD_NAMES: Record<string, string> = {
  utm: "атрибуция",
  meta_campaign_id: "кампания",
  stage_id: "этап",
  status: "статус",
  full_name: "имя",
  deleted_at: "удаление",
  done_at: "выполнение",
  done_by: "кто выполнил",
  result_text: "результат",
  due_at: "срок",
  remind_at: "напоминание",
  assignee_id: "исполнитель",
  title: "название",
  body: "текст",
  merged_into: "слияние",
  email: "почта",
  is_primary: "основной",
};
// Служебные колонки: ни человеку, ни журналу они ничего не говорят.
const HIDDEN_PREFIX = ["amo_", "last_", "first_", "sla_", "intake_", "meta_lead"];
const HIDDEN_KEYS = new Set(["updated_at", "created_at", "closed_at", "deleted_by", "stage_id", "status"]);
const isHidden = (key: string) => HIDDEN_KEYS.has(key) || HIDDEN_PREFIX.some((prefix) => key.startsWith(prefix));

// Переход «этап в самого себя» — запись импорта о том, где сделка завелась.
function transitionText(
  row: { from_stage_id: string | null; to_stage_id: string },
  stageNames: Map<string, string>,
): string {
  const to = stageNames.get(row.to_stage_id) ?? "этап";
  const from = row.from_stage_id ? stageNames.get(row.from_stage_id) : null;
  return from && from !== to ? `${from} → ${to}` : `заведена на этапе «${to}»`;
}

// Строки журнала. Сделка: «поле: было → стало» по каждому полю карточки; остальное — списком названий.
function auditLines(entity: string, action: string, changes: unknown, names: Record<string, string>): string[] {
  const head = `${ACTION_NAMES[action] ?? action}${entity === "deals" ? "" : `: ${ENTITY_NAMES[entity] ?? entity}`}`;
  if (action !== "update") return [head];
  if (entity === "deals") {
    const lines = describeChanges(changes, names).map(changeText);
    const rest = Object.keys((changes && typeof changes === "object" ? changes : {}) as Record<string, unknown>)
      .filter((key) => !isFeedField(key) && !isHidden(key))
      .map((key) => FIELD_NAMES[key] ?? key);
    return lines.length ? (rest.length ? [...lines, `Ещё изменено: ${rest.join(", ")}`] : lines) : rest.length ? [`${head}: ${rest.join(", ")}`] : [];
  }
  const keys = Object.keys((changes && typeof changes === "object" ? changes : {}) as Record<string, unknown>).filter((key) => !isHidden(key));
  const named = keys.map((key) => FIELD_NAMES[key] ?? key);
  if (!named.length) return [];
  return [`${head} — ${named.length > 3 ? `${named.slice(0, 3).join(", ")} и ещё ${named.length - 3}` : named.join(", ")}`];
}
type EventRow = { id: string; at: string; actor: string; subject: string | null; href: string | null; lines: string[] };

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
  const auditQuery = db.from("audit_log").select("id,entity,entity_id,action,actor_id,created_at,changes").order("created_at", { ascending: false }).limit(80);
  if (actorId) auditQuery.eq("actor_id", actorId);
  else if (!showSystem) auditQuery.not("actor_id", "is", null);
  if (params.from) auditQuery.gte("created_at", `${params.from}T00:00:00.000Z`);
  if (params.to) auditQuery.lte("created_at", `${params.to}T23:59:59.999Z`);
  const [transitions, audit] = await Promise.all([transitionsQuery, auditQuery]);
  if (transitions.error) throw new Error(`Переходы: ${transitions.error.message}`);
  if (audit.error) throw new Error(`Журнал: ${audit.error.message}`);
  const actorNames = new Map((profiles.data ?? []).map((row) => [row.id, row.full_name]));
  const auditRows = audit.data ?? [];
  const stageIds = new Set<string>();
  for (const row of transitions.data ?? []) { if (row.from_stage_id) stageIds.add(row.from_stage_id); stageIds.add(row.to_stage_id); }
  // Сделка записи журнала: у сделки это она сама, у задачи и примечания — их deal_id
  // (в создании задачи он лежит в самой записи, иначе читаем строку; удалённые строки
  // закрыты RLS — у таких записей ссылки не будет).
  const dealOfEntity = new Map<string, string>();
  const lookups: { table: "tasks" | "notes"; ids: string[] }[] = [{ table: "tasks", ids: [] }, { table: "notes", ids: [] }];
  for (const row of auditRows) {
    if (row.entity === "deals") dealOfEntity.set(row.entity_id, row.entity_id);
    else if (row.entity === "tasks" || row.entity === "notes") {
      const inline = (row.changes as { deal_id?: unknown } | null)?.deal_id;
      if (typeof inline === "string") dealOfEntity.set(row.entity_id, inline);
      else lookups.find((item) => item.table === row.entity)?.ids.push(row.entity_id);
    }
  }
  const lookedUp = await Promise.all(lookups.map((item) => item.ids.length ? db.from(item.table).select("id,deal_id").in("id", [...new Set(item.ids)]) : Promise.resolve({ data: [], error: null })));
  for (const result of lookedUp) for (const row of (result.data ?? []) as { id: string; deal_id: string | null }[]) if (row.deal_id) dealOfEntity.set(row.id, row.deal_id);
  const dealIds = [...new Set([...(transitions.data ?? []).map((row) => row.deal_id).filter((id): id is string => Boolean(id)), ...dealOfEntity.values()])];
  const nameIds = new Set<string>();
  for (const row of auditRows) for (const key of ["source_id", "lost_reason_id"]) {
    const change = (row.changes as Record<string, { was?: unknown; now?: unknown } | undefined> | null)?.[key];
    for (const value of [change?.was, change?.now]) if (typeof value === "string") nameIds.add(value);
  }
  const [stageResult, dealResult, sourceResult, reasonResult] = await Promise.all([
    stageIds.size ? db.from("stages").select("id,name").in("id", [...stageIds]) : Promise.resolve({ data: [], error: null }),
    dealIds.length ? db.from("deals").select("id,title,contact:contacts!deals_contact_id_fkey(full_name)").in("id", dealIds) : Promise.resolve({ data: [], error: null }),
    nameIds.size ? db.from("sources").select("id,name").in("id", [...nameIds]) : Promise.resolve({ data: [], error: null }),
    nameIds.size ? db.from("lost_reasons").select("id,name").in("id", [...nameIds]) : Promise.resolve({ data: [], error: null }),
  ]);
  if (stageResult.error) throw new Error(`Этапы журнала: ${stageResult.error.message}`);
  if (dealResult.error) throw new Error(`Сделки журнала: ${dealResult.error.message}`);
  const stageNames = new Map((stageResult.data ?? []).map((row) => [row.id, row.name]));
  // Без названия сделки и имени клиента строка «В работе → Отказ» ничего не говорит:
  // непонятно, чья это сделка.
  const dealLabels = new Map(
    ((dealResult.data ?? []) as Array<{ id: string; title: string | null; contact: { full_name: string } | { full_name: string }[] | null }>).map((row) => {
      const contact = (Array.isArray(row.contact) ? row.contact[0]?.full_name : row.contact?.full_name) ?? null;
      const title = row.title?.trim() || null;
      return [row.id, title && contact && title !== contact ? `${title} · ${contact}` : (title ?? contact ?? "Сделка")] as const;
    }),
  );
  // Словарь id → имя для ответственного, источника и причины отказа в «было → стало».
  const valueNames: Record<string, string> = Object.fromEntries([
    ...actorNames,
    ...(sourceResult.data ?? []).map((row) => [row.id, row.name] as const),
    ...(reasonResult.data ?? []).map((row) => [row.id, row.name] as const),
  ]);
  const dealRef = (dealId: string | null | undefined) => (dealId ? { subject: dealLabels.get(dealId) ?? "Сделка", href: `/deals/${dealId}` } : { subject: null, href: null });
  const events: EventRow[] = [
    ...(transitions.data ?? []).map((row) => ({ id: `transition-${row.id}`, at: row.changed_at, actor: actorNames.get(row.changed_by ?? "") ?? "Система", ...dealRef(row.deal_id), lines: [transitionText(row, stageNames)] })),
    ...auditRows.map((row) => {
      const dealId = dealOfEntity.get(row.entity_id);
      const ref = row.entity === "contacts" ? { subject: "Контакт", href: `/contacts/${row.entity_id}` } : dealRef(dealId);
      return { id: `audit-${row.id}`, at: row.created_at, actor: actorNames.get(row.actor_id ?? "") ?? "Система", ...ref, lines: auditLines(row.entity, row.action, row.changes, valueNames) };
    }),
  ].filter((event) => event.lines.length > 0).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 100);
  return <div className={`${styles.page} settings-content`}>
    <header className={styles.header}><div><h1>Журнал изменений</h1><p className={styles.subtitle}>Переходы этапов и изменения записей</p></div></header>
    <Form className={styles.auditFilters} action="/settings/audit" key={`${actorId ?? ""}|${params.from ?? ""}|${params.to ?? ""}|${showSystem}`}><Filter size={15} aria-hidden="true" /><select name="person" defaultValue={actorId ?? ""}><option value="">Все люди</option>{(profiles.data ?? []).map((row) => <option key={row.id} value={row.id}>{row.full_name}</option>)}</select><DateField name="from" defaultValue={params.from ?? ""} aria-label="С даты" placeholder="С даты" clearable /><DateField name="to" defaultValue={params.to ?? ""} aria-label="По дату" placeholder="По дату" clearable /><label className={styles.auditSystem}><input type="checkbox" name="system" value="1" defaultChecked={showSystem} /> Системные</label><button className={styles.filterButton}>Показать</button></Form>
    <div className={styles.auditList}>{events.length ? events.map((event) => <article className={styles.auditRow} key={event.id}><History size={15} /><div>{event.subject && (event.href ? <Link className={styles.auditLink} href={event.href}>{event.subject}</Link> : <span>{event.subject}</span>)}{event.lines.map((line) => <strong key={line}>{line}</strong>)}<p>{event.actor} · {new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Chisinau" }).format(new Date(event.at))}</p></div></article>) : <p className={styles.auditEmpty}>{showSystem ? "За выбранный период изменений нет." : "Люди пока ничего не меняли за этот период. Массовые правки импорта показывает галочка «Системные»."}</p>}</div>
  </div>;
}
