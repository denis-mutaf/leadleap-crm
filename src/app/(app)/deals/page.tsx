import {
  ChevronDown,
  Funnel,
  ListFilter,
  SlidersHorizontal,
  X,
} from "lucide-react";
import Link from "next/link";
import Form from "next/form";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DateField } from "@/components/crm/date-field";
import { DEALS_FILTERS_COOKIE, TAG_SEPARATOR, dealsFilterString, splitTags } from "@/lib/deals-filters";
import { DealsBoard, BoardRefreshGuard, type BoardCard, type BoardColumn } from "./deals-board";
import { CreateDealModal } from "./create-deal-modal";
import { RememberDealsFilters } from "./remember-filters";
import { TagMultiSelect } from "./tag-multi-select";

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
  requires_qualification: boolean;
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

const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;

function dateParam(value: string | undefined): string | null {
  return value && DATE_PARAM.test(value) ? value : null;
}

// Пустой адрес «/deals» значит «вернуть сохранённые фильтры», поэтому снятие
// последнего фильтра ведёт на «/deals?reset=1»: это осознанный пустой выбор.
function withQuery(
  current: Record<string, string | string[] | undefined>,
  changes: Record<string, string | null | undefined>,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(current)) {
    const item = one(value);
    if (key !== "reset" && item !== undefined && item !== "") params.set(key, item);
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === undefined || value === "") params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  return query ? `/deals?${query}` : "/deals?reset=1";
}

function shortDate(value: string) {
  const [, month, day] = value.split("-");
  return `${day}.${month}`;
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
  const tagIds = splitTags(one(query.tag));
  const from = dateParam(one(query.from));
  const to = dateParam(one(query.to));
  const source = one(query.source);
  const mine = one(query.mine) === "1" && !owner;
  const ownerName = !mine ? owners.find((item) => item.id === owner)?.full_name : undefined;
  const projectName = projects.find((item) => item.id === project)?.name;
  const tagNames = tagIds.map((id) => tags.find((item) => item.id === id)?.name).filter(Boolean) as string[];
  const tagLabel = tagNames.length > 2 ? `${tagNames.slice(0, 2).join(", ")} +${tagNames.length - 2}` : tagNames.join(", ");
  const periodLabel = from && to ? `${shortDate(from)} – ${shortDate(to)}` : from ? `с ${shortDate(from)}` : to ? `по ${shortDate(to)}` : null;
  const sourceName = sources.find((item) => item.id === source)?.name;
  const activeChips = [
    mine ? { label: "Только мои", changes: { mine: null } } : null,
    ownerName ? { label: `Ответственный: ${ownerName}`, changes: { owner: null } } : null,
    projectName ? { label: `Проект: ${projectName}`, changes: { project: null } } : null,
    tagNames.length ? { label: `${tagNames.length > 1 ? "Метки" : "Метка"}: ${tagLabel}`, changes: { tag: null } } : null,
    periodLabel ? { label: `Создана: ${periodLabel}`, changes: { from: null, to: null } } : null,
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
      <details className="filter-popover" key={`${sort}|${mine ? "mine" : owner ?? ""}|${project ?? ""}|${tagIds.join(TAG_SEPARATOR)}|${source ?? ""}|${flag ?? ""}|${from ?? ""}|${to ?? ""}`}>
        <summary className="filter-button">
          <ListFilter size={14} /> Фильтр <ChevronDown size={13} />
        </summary>
        <Form className="filter-menu filter-form" action="/deals">
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
          <TagMultiSelect name="tag" tags={tags} defaultSelected={tagIds} />
          <label>
            Источник
            <select name="source" defaultValue={source ?? ""}>
              <option value="">Все источники</option>
              {sources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <div className="filter-period">
            <span>Создана</span>
            <DateField name="from" defaultValue={from ?? ""} aria-label="Создана с" placeholder="с" clearable />
            <DateField name="to" defaultValue={to ?? ""} aria-label="Создана по" placeholder="по" clearable />
          </div>
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
        </Form>
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
  // Зашли без единого параметра (пункт меню, закладка) — возвращаем фильтры,
  // с которыми менеджер ушёл из воронки. «Сбросить» ведёт на ?reset=1 и cookie стирает.
  if (Object.keys(query).length === 0) {
    const saved = (await cookies()).get(DEALS_FILTERS_COOKIE)?.value;
    if (saved) {
      const params = new URLSearchParams(saved);
      const restored = dealsFilterString((key) => params.get(key));
      if (restored) redirect(`/deals?${restored}`);
    }
  }
  const sort = validSort(one(query.sort));
  const flag = validFlag(one(query.flag));
  const tagIds = splitTags(one(query.tag));
  const createdFrom = dateParam(one(query.from));
  const createdTo = dateParam(one(query.to));
  const ownerParam = one(query.owner);
  const mine = one(query.mine) === "1" && !ownerParam;
  const owner = mine ? profile.id : ownerParam || null;
  const effective: Record<string, string | undefined> = {
    owner: ownerParam,
    project: one(query.project),
    tag: tagIds.join(TAG_SEPARATOR),
    source: one(query.source),
    flag: flag ?? undefined,
    sort: one(query.sort) ? sort : undefined,
    mine: mine ? "1" : undefined,
    from: createdFrom ?? undefined,
    to: createdTo ?? undefined,
  };
  const savedFilters = dealsFilterString((key) => effective[key]);
  const supabase = await createClient();
  const [boardResult, stagesResponse, sourcesResponse, projectsResponse, tagsResponse, ownersResponse, lostReasonsResponse, taskTypesResponse] = await Promise.all([
    supabase.rpc("crm_board", {
      p_page: 0,
      p_page_size: PAGE_SIZE,
      p_owner: owner,
      p_project: one(query.project) || null,
      p_tags: tagIds.length ? tagIds : null,
      p_created_from: createdFrom,
      p_created_to: createdTo,
      p_source: one(query.source) || null,
      p_flag: flag,
      p_sort: sort,
    }),
    supabase.from("stages").select("id, name, position, kind, requires_next_step, requires_qualification_tag, requires_qualification").eq("is_active", true).order("position"),
    supabase.from("sources").select("id, name").eq("is_active", true).order("name"),
    supabase.from("projects").select("id, code, name").eq("is_active", true).order("position"),
    supabase.from("tags").select("id, name").eq("is_active", true).order("name"),
    supabase.from("profiles").select("id, full_name, role").eq("is_active", true).in("role", ["manager", "head", "admin"]).order("full_name"),
    supabase.from("lost_reasons").select("id, name").eq("is_active", true).order("position"),
    supabase.from("task_types").select("id, name").eq("is_active", true).order("name"),
  ]);
  if (boardResult.error) throw new Error("Доска сделок: " + boardResult.error.message);
  const board = (boardResult.data ?? {
    columns: {},
    counters: { no_next_step: 0, overdue: 0, today: 0 },
    total: 0,
  }) as BoardResponse;
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
      requires_qualification: stage.requires_qualification,
      won: stage.kind === "won",
    })),
  ];
  const lost = lostStage ? { id: "lost", title: lostStage.name, ...columnData(lostStage.id), kind: "lost" as const, position: lostStage.position } : null;
  const owners = (ownersResponse.data ?? []) as Profile[];
  const sources = (sourcesResponse.data ?? []) as Option[];
  const projects = (projectsResponse.data ?? []) as Project[];
  const tags = (tagsResponse.data ?? []) as Option[];
  return (
    <div className="deals-page">
      <header className="page-header">
        <Funnel size={16} />
        <span>Сделки</span>
      </header>
      <div className="toolbar">
        <button className="view-switch active" type="button"><Funnel size={14} /> Воронка <ChevronDown size={13} /></button>
        <Link className="view-switch" href="/deals/table">Таблица</Link>
        <span className="header-spacer" />
        <CreateDealModal stages={stages} sources={sources} projects={projects} tags={tags} owners={owners} />
      </div>
      <FilterBar query={query} owners={owners} projects={projects} tags={tags} sources={sources} counters={board.counters} />
      <div className="applied-summary">Показано {columns.reduce((sum, column) => sum + column.deals.length, 0)} из {board.total}</div>
      <BoardRefreshGuard serverFlag={flag ?? ""} />
      <RememberDealsFilters value={savedFilters} />
      <DealsBoard
        key={`${sort}|${flag ?? ""}|${mine ? "mine" : ownerParam ?? ""}|${one(query.project) ?? ""}|${tagIds.join(TAG_SEPARATOR)}|${one(query.source) ?? ""}|${createdFrom ?? ""}|${createdTo ?? ""}`}
        columns={columns}
        lost={lost}
        currentUserId={profile.id}
        lostReasons={(lostReasonsResponse.data ?? []) as LostReason[]}
        taskTypes={(taskTypesResponse.data ?? []) as TaskType[]}
        activeAssignees={owners.map((item) => ({ id: item.id, name: item.full_name }))}
        query={{ pageSize: PAGE_SIZE, owner, project: one(query.project) || null, tags: tagIds.length ? tagIds : null, createdFrom, createdTo, source: one(query.source) || null, flag, sort, lostKey: lostStage?.id ?? null }}
      />
    </div>
  );
}
