import { Funnel, House, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const PAGE_SIZE = 24;
const CHUNK_SIZE = 100;
type Stage = { id: string; name: string; position: number };
type Deal = { id: string; contact_id: string; owner_id: string | null; stage_id: string; status: "open" | "postponed" | "won" | "lost"; object_text: string | null; source_id: string | null; budget: number | null; budget_currency: string; postponed_until: string | null };
type Contact = { id: string; full_name: string };
type Profile = { id: string; full_name: string };
type Project = { id: string; code: string; name: string };
type Source = { id: string; name: string };
type Tag = { id: string; name: string };
type LinkRow = { deal_id: string; project_id?: string; tag_id?: string };
type Task = { deal_id: string; title: string; due_at: string };
type ColumnData = { deals: Deal[]; total: number };
type Maps = { contacts: Map<string, Contact>; owners: Map<string, Profile>; sources: Map<string, Source>; projectsByDeal: Map<string, Project[]>; tagsByDeal: Map<string, Tag[]>; tasks: Map<string, Task> };

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function loadByIds<T>(ids: string[], load: (ids: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, label: string): Promise<T[]> {
  if (ids.length === 0) return [];
  const result: T[] = [];
  for (const chunk of chunks(ids, CHUNK_SIZE)) {
    const response = await load(chunk);
    if (response.error) throw new Error(label + ": " + response.error.message);
    result.push(...(response.data ?? []));
  }
  return result;
}

function initials(name: string): string {
  return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function dateLabel(value: string): string {
  return new Date(value).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

function stepForDeal(deal: Deal, task?: Task) {
  if (deal.status === "postponed" && deal.postponed_until) return { text: "Отложена до " + dateLabel(deal.postponed_until), tone: "postponed" };
  if (deal.status === "won" || deal.status === "lost") return null;
  if (!task) return { text: "Нет следующего шага", tone: "warning" };
  const due = new Date(task.due_at);
  if (due < new Date()) return { text: "Просрочено " + Math.max(1, Math.ceil((Date.now() - due.getTime()) / 86400000)) + " дн", tone: "danger" };
  return { text: "Следующий шаг · " + dateLabel(task.due_at), tone: "ok" };
}

function DealCard({ deal, maps }: { deal: Deal; maps: Maps }) {
  const step = stepForDeal(deal, maps.tasks.get(deal.id));
  const budget = deal.budget === null ? null : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(deal.budget) + " " + deal.budget_currency;
  const projects = maps.projectsByDeal.get(deal.id) ?? [];
  const tags = maps.tagsByDeal.get(deal.id) ?? [];
  const owner = deal.owner_id ? maps.owners.get(deal.owner_id) : undefined;
  return (
    <article className={"deal-card " + (step?.tone === "warning" ? "deal-card-warning" : "")}>
      <div className="deal-title"><span className="truncate">{maps.contacts.get(deal.contact_id)?.full_name ?? "Без имени"}</span>{deal.source_id && maps.sources.get(deal.source_id) && <span className="deal-source">{maps.sources.get(deal.source_id)?.name}</span>}</div>
      {deal.object_text && <div className="deal-object"><House size={14} /><span className="truncate">{deal.object_text}</span></div>}
      {(projects.length > 0 || tags.length > 0) && <div className="deal-tags">{projects.map((project) => <span className={"tag " + (project.code === "select" ? "tag-select" : "tag-next")} key={project.id}>{project.name}</span>)}{tags.map((tag) => <span className="tag tag-grey" key={tag.id}>{tag.name}</span>)}</div>}
      {budget && <div className="deal-money">Бюджет: {budget}</div>}
      <div className="deal-footer"><span className="avatar">{owner ? initials(owner.full_name) : "—"}</span>{step && <span className={"task-state " + step.tone}>{step.text}</span>}</div>
    </article>
  );
}

function Column({ title, total, deals, maps, kettle = false }: { title: string; total: number; deals: Deal[]; maps: Maps; kettle?: boolean }) {
  return <section className={kettle ? "kettle" : "kanban-column"}><div className="column-head"><span className={"dot " + (kettle ? "dot-amber" : "dot-blue")} /><strong>{title}</strong><span className="pill">{total}</span>{!kettle && <MoreHorizontal size={15} className="column-more" />}</div>{deals.map((deal) => <DealCard key={deal.id} deal={deal} maps={maps} />)}</section>;
}

async function loadColumn(supabase: Awaited<ReturnType<typeof createClient>>, stageId: string | null, page: number): Promise<ColumnData> {
  let query = supabase.from("deals").select("id, contact_id, owner_id, stage_id, status, object_text, source_id, budget, budget_currency, postponed_until", { count: "exact" }).not("status", "in", "(won,lost)").order("updated_at", { ascending: false }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  query = stageId ? query.eq("stage_id", stageId).not("owner_id", "is", null) : query.is("owner_id", null);
  const response = await query;
  if (response.error) throw new Error("Сделки: " + response.error.message);
  return { deals: (response.data ?? []) as Deal[], total: response.count ?? 0 };
}

export default async function DealsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role === "builder") redirect("/reports");
  const pageValue = Number.parseInt((await searchParams).page ?? "0", 10);
  const page = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 0;
  const supabase = await createClient();
  const stagesResponse = await supabase.from("stages").select("id, name, position").eq("is_active", true).eq("kind", "open").order("position");
  if (stagesResponse.error) throw new Error("Этапы: " + stagesResponse.error.message);
  const stages = (stagesResponse.data ?? []) as Stage[];
  const [kettle, ...columns] = await Promise.all([loadColumn(supabase, null, page), ...stages.map((stage) => loadColumn(supabase, stage.id, page))]);
  const allDeals = [kettle.deals, ...columns.map((column) => column.deals)].flat();
  const dealIds = allDeals.map((deal) => deal.id);
  const sourceIds = allDeals.flatMap((deal) => deal.source_id ? [deal.source_id] : []);
  const ownerIds = allDeals.flatMap((deal) => deal.owner_id ? [deal.owner_id] : []);
  const [contacts, owners, projectRows, sources, tagRows, tasks] = await Promise.all([
    loadByIds(allDeals.map((deal) => deal.contact_id), (ids) => supabase.from("contacts").select("id, full_name").in("id", ids), "Контакты"),
    loadByIds(ownerIds, (ids) => supabase.from("profiles").select("id, full_name").in("id", ids), "Ответственные"),
    loadByIds(dealIds, (ids) => supabase.from("deal_projects").select("deal_id, project_id").in("deal_id", ids), "Проекты сделок"),
    loadByIds(sourceIds, (ids) => supabase.from("sources").select("id, name").in("id", ids), "Источники"),
    loadByIds(dealIds, (ids) => supabase.from("deal_tags").select("deal_id, tag_id").in("deal_id", ids), "Теги сделок"),
    loadByIds(dealIds, (ids) => supabase.from("tasks").select("deal_id, title, due_at").in("deal_id", ids).is("done_at", null).order("due_at"), "Задачи"),
  ]);
  const projectIds = (projectRows as LinkRow[]).flatMap((row) => row.project_id ? [row.project_id] : []);
  const tagIds = (tagRows as LinkRow[]).flatMap((row) => row.tag_id ? [row.tag_id] : []);
  const [projects, tags] = await Promise.all([
    loadByIds(projectIds, (ids) => supabase.from("projects").select("id, code, name").in("id", ids), "Проекты"),
    loadByIds(tagIds, (ids) => supabase.from("tags").select("id, name").in("id", ids), "Теги"),
  ]);
  const maps: Maps = { contacts: new Map((contacts as Contact[]).map((row) => [row.id, row])), owners: new Map((owners as Profile[]).map((row) => [row.id, row])), sources: new Map((sources as Source[]).map((row) => [row.id, row])), projectsByDeal: new Map(), tagsByDeal: new Map(), tasks: new Map() };
  const projectMap = new Map((projects as Project[]).map((row) => [row.id, row]));
  const tagMap = new Map((tags as Tag[]).map((row) => [row.id, row]));
  (projectRows as LinkRow[]).forEach((row) => { const item = row.project_id ? projectMap.get(row.project_id) : undefined; if (item) maps.projectsByDeal.set(row.deal_id, [...(maps.projectsByDeal.get(row.deal_id) ?? []), item]); });
  (tagRows as LinkRow[]).forEach((row) => { const item = row.tag_id ? tagMap.get(row.tag_id) : undefined; if (item) maps.tagsByDeal.set(row.deal_id, [...(maps.tagsByDeal.get(row.deal_id) ?? []), item]); });
  (tasks as Task[]).forEach((task) => { if (!maps.tasks.has(task.deal_id)) maps.tasks.set(task.deal_id, task); });
  const shown = allDeals.length;
  const total = kettle.total + columns.reduce((sum, column) => sum + column.total, 0);
  const hasNextPage = [kettle, ...columns].some((column) => (page + 1) * PAGE_SIZE < column.total);
  return <div className="deals-page"><header className="page-header"><Funnel size={16} /><span>Сделки</span><span className="header-spacer" /><span className="avatar">{initials(profile.full_name)}</span></header><div className="toolbar"><span className="toolbar-label">Воронка</span><span className="header-spacer" /><span className="summary">Открытые сделки</span></div><div className="filterbar"><span className="static-filter">Сортировка</span><span className="separator" /><span className="static-filter">Фильтр</span><span className="header-spacer" /><span className="summary">Страница {page + 1} · показано {shown} из {total}</span></div><div className="board"><Column title="Общий котёл" total={kettle.total} deals={kettle.deals} maps={maps} kettle />{stages.map((stage, index) => <Column key={stage.id} title={stage.name} total={columns[index].total} deals={columns[index].deals} maps={maps} />)}</div>{(page > 0 || hasNextPage) && <nav className="deals-pagination" aria-label="Страницы сделок">{page > 0 && <Link href={`/deals?page=${page - 1}`}>Предыдущая</Link>}{hasNextPage && <Link href={`/deals?page=${page + 1}`}>Следующая</Link>}</nav>}</div>;
}
