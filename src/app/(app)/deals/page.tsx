import {
  Bell,
  ChevronDown,
  Funnel,
  ListFilter,
  SlidersHorizontal,
  X,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DealsBoard, type BoardCard, type BoardColumn } from "./deals-board";
import { CreateDealModal } from "./create-deal-modal";

const PAGE_SIZE = 24;
const SORTS = [
  ["updated", "Дата обновления"],
  ["created", "Дата создания"],
  ["budget", "Сумма"],
  ["contact", "Имя контакта"],
] as const;
const FLAGS = [
  ["no_next_step", "Без следующего шага"],
  ["overdue", "Просрочено"],
  ["today", "На сегодня"],
] as const;

type Stage = {
  id: string;
  name: string;
  position: number;
  kind: "open" | "won" | "lost";
  requires_next_step: boolean;
  requires_qualification_tag: boolean;
};
type Option = { id: string; name: string };
type Project = Option & { code: string };
type Profile = { id: string; full_name: string; role?: string };
type LostReason = Option;
type TaskType = Option;
type BoardResponse = {
  columns: Record<string, { total: number; sum: number | null; deals: BoardCard[] }>;
  counters: { no_next_step: number; overdue: number; today: number };
  total: number;
};

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function validSort(value: string | undefined): (typeof SORTS)[number][0] {
  return SORTS.some(([key]) => key === value)
    ? (value as (typeof SORTS)[number][0])
    : "updated";
}

function validFlag(value: string | undefined): (typeof FLAGS)[number][0] | null {
  return FLAGS.some(([key]) => key === value)
    ? (value as (typeof FLAGS)[number][0])
    : null;
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function withQuery(
  current: Record<string, string | string[] | undefined>,
  changes: Record<string, string | null | undefined>,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(current)) {
    const item = one(value);
    if (item !== undefined && item !== "") params.set(key, item);
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === undefined || value === "") params.delete(key);
    else params.set(key, value);
  }
  params.set("page", changes.page ?? "0");
  const query = params.toString();
  return query ? `/deals?${query}` : "/deals";
}

function FilterChip({ label, href }: { label: string; href: string }) {
  return (
    <Link className="filter-chip" href={href}>
      {label}
      <X size={12} aria-hidden="true" />
    </Link>
  );
}

function FilterBar({
  query,
  owners,
  projects,
  tags,
  sources,
  counters,
}: {
  query: Record<string, string | string[] | undefined>;
  owners: Profile[];
  projects: Project[];
  tags: Option[];
  sources: Option[];
  counters: BoardResponse["counters"];
}) {
  const sort = validSort(one(query.sort));
  const flag = validFlag(one(query.flag));
  const owner = one(query.owner);
  const project = one(query.project);
  const tag = one(query.tag);
  const source = one(query.source);
  const mine = one(query.mine) === "1" && !owner;
  const ownerName = !mine ? owners.find((item) => item.id === owner)?.full_name : undefined;
  const projectName = projects.find((item) => item.id === project)?.name;
  const tagName = tags.find((item) => item.id === tag)?.name;
  const sourceName = sources.find((item) => item.id === source)?.name;
  const activeChips = [
    mine ? { label: "Только мои", changes: { mine: null } } : null,
    ownerName ? { label: `Ответственный: ${ownerName}`, changes: { owner: null } } : null,
    projectName ? { label: `Проект: ${projectName}`, changes: { project: null } } : null,
    tagName ? { label: `Метка: ${tagName}`, changes: { tag: null } } : null,
    sourceName ? { label: `Источник: ${sourceName}`, changes: { source: null } } : null,
    flag ? { label: FLAGS.find(([key]) => key === flag)?.[1] ?? flag, changes: { flag: null } } : null,
  ].filter(Boolean) as unknown as { label: string; changes: Record<string, string | null | undefined> }[];

  return (
    <div className="filterbar">
      <details className="filter-popover">
        <summary className="filter-button">
          <SlidersHorizontal size={14} /> Сортировка <ChevronDown size={13} />
        </summary>
        <div className="filter-menu">
          {SORTS.map(([key, label]) => (
            <Link
              className={sort === key ? "is-selected" : ""}
              href={withQuery(query, { sort: key })}
              key={key}
            >
              {label}
              {sort === key && <span aria-hidden="true">✓</span>}
            </Link>
          ))}
        </div>
      </details>
      <span className="separator" />
      <details className="filter-popover">
        <summary className="filter-button">
          <ListFilter size={14} /> Фильтр <ChevronDown size={13} />
        </summary>
        <form className="filter-menu filter-form" method="get">
          <input type="hidden" name="sort" value={sort} />
          <label>
            Ответственный
            <select name="owner" defaultValue={mine ? "" : owner ?? ""}>
              <option value="">Все ответственные</option>
              {owners.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}
            </select>
          </label>
          <label>
            Проект
            <select name="project" defaultValue={project ?? ""}>
              <option value="">Все проекты</option>
              {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>
            Метка
            <select name="tag" defaultValue={tag ?? ""}>
              <option value="">Все метки</option>
              {tags.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>
            Источник
            <select name="source" defaultValue={source ?? ""}>
              <option value="">Все источники</option>
              {sources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>
            Состояние
            <select name="flag" defaultValue={flag ?? ""}>
              <option value="">Все сделки</option>
              {FLAGS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label className="filter-check">
            <input type="checkbox" name="mine" value="1" defaultChecked={mine && !owner} />
            Только мои
          </label>
          <button className="btn filter-submit" type="submit">Применить</button>
          <span className="filter-help">Мои сделки фильтруются по текущему пользователю</span>
        </form>
      </details>
      <div className="filter-chips">
        {activeChips.map((chip) => <FilterChip key={chip.label} label={chip.label} href={withQuery(query, chip.changes)} />)}
      </div>
      <span className="header-spacer" />
      <div className="counter-filters" aria-label="Быстрые фильтры">
        <Link className={flag === "no_next_step" ? "is-active counter-no-step" : "counter-no-step"} href={withQuery(query, { flag: flag === "no_next_step" ? null : "no_next_step" })}>
          <i /> Без следующего шага <b>{counters.no_next_step}</b>
        </Link>
        <Link className={flag === "overdue" ? "is-active counter-overdue" : "counter-overdue"} href={withQuery(query, { flag: flag === "overdue" ? null : "overdue" })}>
          <i /> Просрочено <b>{counters.overdue}</b>
        </Link>
        <Link className={flag === "today" ? "is-active counter-today" : "counter-today"} href={withQuery(query, { flag: flag === "today" ? null : "today" })}>
          <i /> На сегодня <b>{counters.today}</b>
        </Link>
      </div>
    </div>
  );
}

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role === "builder") redirect("/reports");
  const query = await searchParams;
  const pageValue = Number.parseInt(one(query.page) ?? "0", 10);
  const page = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 0;
  const sort = validSort(one(query.sort));
  const flag = validFlag(one(query.flag));
  const ownerParam = one(query.owner);
  const mine = one(query.mine) === "1" && !ownerParam;
  const owner = mine ? profile.id : ownerParam || null;
  const supabase = await createClient();
  const boardResult = await supabase.rpc("crm_board", {
    p_page: page,
    p_page_size: PAGE_SIZE,
    p_owner: owner,
    p_project: one(query.project) || null,
    p_tag: one(query.tag) || null,
    p_source: one(query.source) || null,
    p_flag: flag,
    p_sort: sort,
  });
  if (boardResult.error) throw new Error("Доска сделок: " + boardResult.error.message);
  const board = (boardResult.data ?? {
    columns: {},
    counters: { no_next_step: 0, overdue: 0, today: 0 },
    total: 0,
  }) as BoardResponse;
  const [stagesResponse, sourcesResponse, projectsResponse, tagsResponse, ownersResponse, lostReasonsResponse, taskTypesResponse] = await Promise.all([
    supabase.from("stages").select("id, name, position, kind, requires_next_step, requires_qualification_tag").eq("is_active", true).order("position"),
    supabase.from("sources").select("id, name").eq("is_active", true).order("name"),
    supabase.from("projects").select("id, code, name").eq("is_active", true).order("position"),
    supabase.from("tags").select("id, name").eq("is_active", true).order("name"),
    supabase.from("profiles").select("id, full_name, role").eq("is_active", true).in("role", ["manager", "head", "admin"]).order("full_name"),
    supabase.from("lost_reasons").select("id, name").eq("is_active", true).order("position"),
    supabase.from("task_types").select("id, name").eq("is_active", true).order("name"),
  ]);
  const responses = [stagesResponse, sourcesResponse, projectsResponse, tagsResponse, ownersResponse, lostReasonsResponse, taskTypesResponse];
  const failed = responses.find((item) => item.error);
  if (failed?.error) throw new Error("Справочники воронки: " + failed.error.message);
  console.info("[deals] Supabase calls: before ≈40; after 8 data calls (1 crm_board + 7 справочников)");

  const allStages = (stagesResponse.data ?? []) as Stage[];
  const stages = allStages.filter((stage) => stage.kind !== "lost");
  const lostStage = allStages.find((stage) => stage.kind === "lost");
  const columnData = (id: string) => board.columns[id] ?? { total: 0, sum: null, deals: [] };
  const columns: BoardColumn[] = [
    { id: "kettle", title: "Общий котёл", ...columnData("kettle"), kettle: true },
    ...stages.map((stage) => ({
      id: stage.id,
      title: stage.name,
      ...columnData(stage.id),
      kind: stage.kind,
      position: stage.position,
      requires_next_step: stage.requires_next_step,
      requires_qualification_tag: stage.requires_qualification_tag,
      won: stage.kind === "won",
    })),
  ];
  const lost = lostStage ? { id: "lost", title: lostStage.name, ...columnData(lostStage.id), kind: "lost" as const, position: lostStage.position } : null;
  const hasNextPage = columns.some((column) => (page + 1) * PAGE_SIZE < column.total);
  const owners = (ownersResponse.data ?? []) as Profile[];
  const sources = (sourcesResponse.data ?? []) as Option[];
  const projects = (projectsResponse.data ?? []) as Project[];
  const tags = (tagsResponse.data ?? []) as Option[];
  return (
    <div className="deals-page">
      <header className="page-header">
        <Funnel size={16} />
        <span>Сделки</span>
        <span className="header-spacer" />
        <span className="header-notification"><Bell size={15} /><b>38</b></span>
        <span className="avatar">{initials(profile.full_name)}</span>
      </header>
      <div className="toolbar">
        <button className="view-switch active" type="button"><Funnel size={14} /> Воронка <ChevronDown size={13} /></button>
        <Link className="view-switch" href="/deals/table">Таблица</Link>
        <button className="view-switch" type="button"><SlidersHorizontal size={14} /> Настройки вида <ChevronDown size={13} /></button>
        <span className="header-spacer" />
        <CreateDealModal stages={stages} sources={sources} projects={projects} tags={tags} owners={owners} />
      </div>
      <FilterBar query={query} owners={owners} projects={projects} tags={tags} sources={sources} counters={board.counters} />
      <div className="applied-summary">Страница {page + 1} · показано {columns.reduce((sum, column) => sum + column.deals.length, 0)} из {board.total}</div>
      <DealsBoard
        columns={columns}
        lost={lost}
        currentUserId={profile.id}
        lostReasons={(lostReasonsResponse.data ?? []) as LostReason[]}
        taskTypes={(taskTypesResponse.data ?? []) as TaskType[]}
        activeAssignees={owners.map((item) => ({ id: item.id, name: item.full_name }))}
      />
      {(page > 0 || hasNextPage) && (
        <nav className="deals-pagination" aria-label="Страницы сделок">
          {page > 0 && <Link href={withQuery(query, { page: String(page - 1) })}>Предыдущая</Link>}
          {hasNextPage && <Link href={withQuery(query, { page: String(page + 1) })}>Следующая</Link>}
        </nav>
      )}
    </div>
  );
}
