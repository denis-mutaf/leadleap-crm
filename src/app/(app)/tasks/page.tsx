import Link from "next/link";
import Form from "next/form";
import { redirect } from "next/navigation";
import { CheckSquare, Search, X } from "lucide-react";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/crm/empty-state";
import { DateField } from "@/components/crm/date-field";
import { AutoSubmitForm } from "../auto-submit-form";
import { TaskRow } from "./task-row";
import styles from "./tasks.module.css";

type TaskRow = {
  id: string;
  deal_id: string | null;
  contact_id: string | null;
  assignee_id: string | null;
  type_id: string | null;
  title: string | null;
  due_at: string;
  done_at: string | null;
  result_text: string | null;
};
type Related = {
  id: string;
  full_name?: string;
  name?: string;
  code?: string;
  stage_id?: string | null;
  contact_id?: string | null;
  kind?: string;
  position?: number;
};
type ViewTask = TaskRow & {
  typeName: string;
  contactName: string;
  stageName: string;
  stage: { id: string; kind: "open" | "won" | "lost"; position: number } | null;
  allStages: { id: string; kind: "open" | "won" | "lost"; position: number }[];
  assigneeName: string;
  dueLabel: string;
  overdueLabel?: string;
  typeCode?: string | null;
};
const typeFallback: Record<string, string> = {
  call: "Звонок",
  meeting: "Встреча",
  presentation: "Презентация",
  message: "Написать в мессенджер",
  documents: "Документы",
};
const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Chisinau",
  day: "numeric",
  month: "short",
});
const timeFormatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Chisinau",
  hour: "2-digit",
  minute: "2-digit",
});
const localDate = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Chisinau",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
const addDays = (value: string, days: number) => {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const unique = (values: (string | null | undefined)[]) => [
  ...new Set(values.filter((value): value is string => Boolean(value))),
];

async function relationRows<T extends Related>(
  query: () => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
  label: string,
  ids: string[],
) {
  if (!ids.length) return [] as T[];
  const result = await query();
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data ?? [];
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    assignee?: string;
    type?: string;
    from?: string;
    to?: string;
    q?: string;
  }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  if (profile.role === "builder") redirect("/reports");
  const supabase = await createClient();
  const params = await searchParams;
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
  const page =
    Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const pageSize = 100;
  const defaultAssignee = ["head", "admin"].includes(profile.role)
    ? "all"
    : profile.id;
  const assignee = params.assignee || defaultAssignee;
  const typeId = params.type || "";
  const query = params.q?.trim() || "";
  const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(params.from ?? "")
    ? params.from
    : "";
  const toDate = /^\d{4}-\d{2}-\d{2}$/.test(params.to ?? "")
    ? params.to
    : "";
  // Один и тот же набор фильтров ложится и на select(), и на head-счётчики, а
  // тип билдера Supabase меняется на каждом звене цепочки. Структурный дженерик
  // здесь уходит в TS2589 «instantiation is excessively deep»: рекурсия по
  // собственному типу складывается с рекурсией PostgrestFilterBuilder.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyFilters = (base: any) => {
    let next = base;
    if (assignee !== "all") next = next.eq("assignee_id", assignee);
    if (typeId) next = next.eq("type_id", typeId);
    if (fromDate) next = next.gte("due_at", `${fromDate}T00:00:00.000Z`);
    if (toDate) next = next.lt("due_at", `${addDays(toDate, 1)}T00:00:00.000Z`);
    if (query) {
      const escaped = query.replace(/[\\%_]/g, (value) => `\\${value}`);
      next = next.ilike("title", `%${escaped}%`);
    }
    return next;
  };
  const today = localDate(new Date());
  const tomorrow = addDays(today, 1);
  // Счётчики в шапке считает база, а не загруженная страница. Иначе при
  // сотне задач на странице «Просрочено 100» — это размер страницы, а
  // «Сегодня 0» — просто «сегодняшние не попали в первую сотню».
  // Экран собирался восемью последовательными походами в базу — около трёх
  // секунд, из которых сама база тратит миллисекунды, остальное дорога.
  // Запросы, которые ничего друг от друга не ждут, идут одной волной:
  // счётчики и словари фильтров не зависят ни от чего.
  const [countersResult, allTypes, allPeople] = await Promise.all([
    supabase.rpc("crm_task_counters", {
      p_assignee: assignee === "all" ? null : assignee,
      p_type: typeId || null,
      p_from: fromDate ? `${fromDate}T00:00:00.000Z` : null,
      p_to: toDate ? `${addDays(toDate, 1)}T00:00:00.000Z` : null,
      p_query: query || null,
    }),
    relationRows(
      () => supabase.from("task_types").select("id, name, code").order("name"),
      "Фильтры типов задач",
      ["all"],
    ),
    relationRows(
      () =>
        supabase
          .from("profiles")
          .select("id, full_name")
          .eq("is_active", true)
          .order("full_name"),
      "Фильтры ответственных",
      ["all"],
    ),
  ]);
  if (countersResult.error)
    throw new Error(`Счётчики задач: ${countersResult.error.message}`);
  const counters = countersResult.data as Record<string, number> | null;
  const counterValue = (key: string) => {
    const value = counters?.[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
      throw new Error(`Счётчики задач: не пришло число «${key}»`);
    return value;
  };
  const totalCount = counterValue("total");
  const overdueTotal = counterValue("overdue");
  const todayTotal = counterValue("today");
  const tomorrowTotal = counterValue("tomorrow");
  const openTotal = counterValue("open");
  const totalPages = Math.ceil(totalCount / pageSize);
  const safePage = totalPages > 0 ? Math.min(page, totalPages) : 1;
  const from = (safePage - 1) * pageSize;
  const to = from + pageSize - 1;
  const filteredResult = await applyFilters(
    supabase.from("tasks").select(
      "id, deal_id, contact_id, assignee_id, type_id, title, due_at, done_at, result_text",
    ),
  )
    .order("done_at", { ascending: true, nullsFirst: true })
    .order("due_at", { ascending: true })
    .order("id", { ascending: true })
    .range(from, to);
  if (filteredResult.error)
    throw new Error(`Задачи: ${filteredResult.error.message}`);
  const rows = (filteredResult.data ?? []) as TaskRow[];
  const typeIds = unique(rows.map((row) => row.type_id));
  const contactIds = unique(rows.map((row) => row.contact_id));
  const dealIds = unique(rows.map((row) => row.deal_id));
  const profileIds = unique(rows.map((row) => row.assignee_id));
  const [types, contacts, deals, people] = await Promise.all([
    relationRows(
      () =>
        supabase.from("task_types").select("id, name, code").in("id", typeIds),
      "Типы задач",
      typeIds,
    ),
    relationRows(
      () =>
        supabase.from("contacts").select("id, full_name").in("id", contactIds),
      "Контакты",
      contactIds,
    ),
    relationRows(
      () =>
        supabase
          .from("deals")
          .select("id, stage_id, contact_id")
          .in("id", dealIds),
      "Сделки",
      dealIds,
    ),
    relationRows(
      () =>
        supabase.from("profiles").select("id, full_name").in("id", profileIds),
      "Ответственные",
      profileIds,
    ),
  ]);
  const dealContactIds = unique(deals.map((deal) => deal.contact_id));
  const [fallbackContacts, stagesResult] = await Promise.all([
    relationRows(
      () =>
        supabase
          .from("contacts")
          .select("id, full_name")
          .in("id", dealContactIds),
      "Контакты сделок",
      dealContactIds,
    ),
    supabase.from("stages").select("id, name, kind, position").order("position"),
  ]);
  if (stagesResult.error) throw new Error(`Этапы: ${stagesResult.error.message}`);
  const stages = stagesResult.data ?? [];
  const typeMap = new Map(types.map((item) => [item.id, item]));
  const contactMap = new Map(
    [...contacts, ...fallbackContacts].map((item) => [
      item.id,
      item.full_name ?? "Контакт",
    ]),
  );
  const dealMap = new Map(deals.map((item) => [item.id, item]));
  const stageMap = new Map(
    stages.map((item) => [item.id, item.name ?? "Без этапа"]),
  );
  const stageObjects = stages.map((item) => ({
    id: item.id,
    kind: (item.kind === "won" || item.kind === "lost" ? item.kind : "open") as "open" | "won" | "lost",
    position: item.position ?? 0,
  }));
  const peopleMap = new Map(
    people.map((item) => [item.id, item.full_name ?? profile.full_name]),
  );
  const viewTasks: ViewTask[] = rows.map((row) => {
    const type = typeMap.get(row.type_id ?? "");
    const deal = dealMap.get(row.deal_id ?? "");
    const contactId = row.contact_id ?? deal?.contact_id;
    const dueDate = localDate(new Date(row.due_at));
    const delta = Math.round(
      (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${dueDate}T12:00:00Z`)) /
        86400000,
    );
    return {
      ...row,
      typeName: type?.name ?? typeFallback[type?.code ?? ""] ?? "Задача",
      contactName: contactMap.get(contactId ?? "") ?? "Контакт не указан",
      stageName: stageMap.get(deal?.stage_id ?? "") ?? "Без этапа",
      stage: stageObjects.find((stage) => stage.id === (deal?.stage_id ?? "")) ?? null,
      allStages: stageObjects,
      assigneeName: peopleMap.get(row.assignee_id ?? "") ?? profile.full_name,
      dueLabel:
        dueDate === today || dueDate === tomorrow
          ? timeFormatter.format(new Date(row.due_at))
          : dateFormatter.format(new Date(row.due_at)),
      overdueLabel: delta > 0 ? `просрочено ${delta} дн` : undefined,
      typeCode: type?.code,
    };
  });
  const groupForTask = (task: ViewTask) => {
    if (task.done_at) return "done";
    const date = localDate(new Date(task.due_at));
    if (date < today) return "overdue";
    if (date === today) return "today";
    if (date === tomorrow) return "tomorrow";
    return "later";
  };
  // Заголовок группы печатал длину загруженной страницы: на экране стояло
  // «Просрочено 100» под шапкой «Просрочено 118». Одно и то же слово с двумя
  // числами читается как ошибка. Группа знает свой настоящий размер и говорит
  // «100 из 118», когда страница его не вмещает.
  const groups = [
    {
      key: "overdue",
      label: "Просрочено",
      tone: "danger",
      total: overdueTotal,
      tasks: viewTasks.filter((task) => groupForTask(task) === "overdue"),
    },
    {
      key: "today",
      label: "Сегодня",
      total: todayTotal,
      tasks: viewTasks.filter((task) => groupForTask(task) === "today"),
    },
    {
      key: "tomorrow",
      label: "Завтра",
      total: tomorrowTotal,
      tasks: viewTasks.filter((task) => groupForTask(task) === "tomorrow"),
    },
    {
      key: "later",
      label: "Позже",
      total: Math.max(
        0,
        openTotal - overdueTotal - todayTotal - tomorrowTotal,
      ),
      tasks: viewTasks.filter((task) => groupForTask(task) === "later"),
    },
    {
      key: "done",
      label: "Выполненные",
      total: Math.max(0, totalCount - openTotal),
      tasks: viewTasks.filter((task) => groupForTask(task) === "done"),
    },
  ].filter((group) => group.tasks.length);
  return (
    <div className="tasks-page">
      <header className="tasks-header">
        <h1><CheckSquare size={16} aria-hidden="true" /> Задачи</h1>
        <span className="header-spacer" />
        <span className={`tasks-total ${styles.total}`}>
          Показано {rows.length} из {totalCount}
        </span>
      </header>
      <div className="tasks-toolbar">
        <div className="view-switch" aria-label="Вид задач">
          <span className="view-switch-active">Список</span>
        </div>
        <span className="header-spacer" />
        <Form action="/tasks" className={styles.searchForm} key={`search|${query}|${assignee}|${typeId}|${fromDate}|${toDate}`}>
          {assignee !== "all" && <input type="hidden" name="assignee" value={assignee} />}
          {typeId && <input type="hidden" name="type" value={typeId} />}
          {fromDate && <input type="hidden" name="from" value={fromDate} />}
          {toDate && <input type="hidden" name="to" value={toDate} />}
          <Search size={14} />
          <input name="q" defaultValue={query} placeholder="Поиск по задачам" aria-label="Поиск по задачам" />
          <button className="task-icon-button" type="submit" aria-label="Найти"><Search size={14} /></button>
        </Form>
      </div>
      <AutoSubmitForm action="/tasks" className="tasks-filterbar" key={`filters|${assignee}|${typeId}|${fromDate}|${toDate}|${query}`}>
        <label className={styles.filterField}>
          <span>Ответственный</span>
          <select name="assignee" defaultValue={assignee}>
            <option value="all">Все</option>
            {allPeople.map((person) => (
              <option key={person.id} value={person.id}>{person.full_name}</option>
            ))}
          </select>
        </label>
        <label className={styles.filterField}>
          <span>Тип</span>
          <select name="type" defaultValue={typeId}>
            <option value="">Все типы</option>
            {allTypes.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
        <label className={styles.periodField}>
          <span>Период</span>
          <DateField name="from" defaultValue={fromDate} aria-label="Дата от" placeholder="с" autoSubmit clearable />
          <DateField name="to" defaultValue={toDate} aria-label="Дата до" placeholder="по" autoSubmit clearable />
        </label>
        <input type="hidden" name="q" value={query} />
        <Link className={styles.clear} href="/tasks" aria-label="Сбросить фильтры"><X size={14} /></Link>
        <span className="header-spacer" />
        <span className={`task-counter ${overdueTotal > 0 ? "is-hot" : "danger"}`}>
          <i />
          Просрочено {overdueTotal}
        </span>
        <span className="task-counter blue">
          <i />
          Сегодня {todayTotal}
        </span>
        <span className="task-counter">
          <i />
          Завтра {tomorrowTotal}
        </span>
      </AutoSubmitForm>
      <main className="task-list motion-list">
        {groups.map((group, index) => (
          <section className="task-group" key={group.key} style={{ "--i": index } as import("react").CSSProperties}>
            <div
              className={`task-group-header ${group.tone === "danger" ? "is-danger" : ""}`}
            >
              <span>{group.label}</span>
              <b>
                {group.total > group.tasks.length
                  ? `${group.tasks.length} из ${group.total}`
                  : group.tasks.length}
              </b>
            </div>
            {group.tasks.map((task) => <TaskRow key={task.id} task={task} actorId={profile.id} />)}
          </section>
        ))}
        {!groups.length && (
          <EmptyState
            title={
              assignee !== "all"
                ? "У вас нет задач на этот период"
                : query || fromDate || toDate || typeId
                  ? "По этим фильтрам задач нет"
                  : "Задач пока нет"
            }
            description="Здесь появятся задачи для следующего шага по контакту или сделке."
            action={
              assignee !== "all" ? (
                <Link href="/tasks?assignee=all">
                  Показать задачи всей команды
                </Link>
              ) : query || fromDate || toDate || typeId ? (
                <Link href="/tasks">Сбросить фильтры</Link>
              ) : undefined
            }
          />
        )}
        {totalPages > 1 && (
          <nav className="tasks-pagination" aria-label="Страницы задач">
            {safePage > 1 ? (
              <Link href={`/tasks?page=${safePage - 1}`}>← Назад</Link>
            ) : (
              <span />
            )}
            <span>
              Страница {safePage} из {totalPages}
            </span>
            {safePage < totalPages ? (
              <Link href={`/tasks?page=${safePage + 1}`}>Вперёд →</Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </main>
    </div>
  );
}
