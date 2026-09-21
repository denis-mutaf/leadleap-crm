import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { TaskCompletion } from "./task-completion";

type TaskRow = {
  id: string;
  deal_id: string | null;
  contact_id: string | null;
  assignee_id: string | null;
  type_id: string | null;
  title: string | null;
  due_at: string;
  done_at: string | null;
  result_text?: string | null;
};
type Related = {
  id: string;
  full_name?: string;
  name?: string;
  code?: string;
  stage_id?: string | null;
  contact_id?: string | null;
};
type ViewTask = TaskRow & {
  typeName: string;
  contactName: string;
  stageName: string;
  assigneeName: string;
  dueLabel: string;
  overdueLabel?: string;
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
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "—";
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
  searchParams: Promise<{ page?: string }>;
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
  const countResult = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("assignee_id", profile.id)
    .is("done_at", null);
  if (countResult.error)
    throw new Error(`Количество задач: ${countResult.error.message}`);
  const totalCount = countResult.count ?? 0;
  const totalPages = Math.ceil(totalCount / pageSize);
  const safePage = totalPages > 0 ? Math.min(page, totalPages) : 1;
  const from = (safePage - 1) * pageSize;
  const to = from + pageSize - 1;
  const result = await supabase
    .from("tasks")
    .select(
      "id, deal_id, contact_id, assignee_id, type_id, title, due_at, done_at",
    )
    .eq("assignee_id", profile.id)
    .is("done_at", null)
    .order("due_at", { ascending: true })
    .order("id", { ascending: true })
    .range(from, to);
  if (result.error) throw new Error(`Задачи: ${result.error.message}`);
  const rows = (result.data ?? []) as TaskRow[];
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
  const fallbackContacts = await relationRows(
    () =>
      supabase
        .from("contacts")
        .select("id, full_name")
        .in("id", dealContactIds),
    "Контакты сделок",
    dealContactIds,
  );
  const stageIds = unique(deals.map((deal) => deal.stage_id));
  const stages = await relationRows(
    () => supabase.from("stages").select("id, name").in("id", stageIds),
    "Этапы",
    stageIds,
  );
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
  const peopleMap = new Map(
    people.map((item) => [item.id, item.full_name ?? profile.full_name]),
  );
  const today = localDate(new Date());
  const tomorrow = addDays(today, 1);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const weekEnd = addDays(today, weekday === 0 ? 0 : 7 - weekday);
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
      assigneeName: peopleMap.get(row.assignee_id ?? "") ?? profile.full_name,
      dueLabel:
        dueDate === today || dueDate === tomorrow
          ? timeFormatter.format(new Date(row.due_at))
          : dateFormatter.format(new Date(row.due_at)),
      overdueLabel: delta > 0 ? `просрочено ${delta} дн` : undefined,
    };
  });
  const groupForTask = (task: ViewTask) => {
    const date = localDate(new Date(task.due_at));
    if (date < today) return "overdue";
    if (date === today) return "today";
    if (date === tomorrow) return "tomorrow";
    if (date <= weekEnd) return "week";
    return "later";
  };
  const groups = [
    {
      key: "overdue",
      label: "Просрочено",
      tone: "danger",
      tasks: viewTasks.filter((task) => groupForTask(task) === "overdue"),
    },
    {
      key: "today",
      label: "Сегодня",
      tasks: viewTasks.filter((task) => groupForTask(task) === "today"),
    },
    {
      key: "tomorrow",
      label: "Завтра",
      tasks: viewTasks.filter((task) => groupForTask(task) === "tomorrow"),
    },
    {
      key: "week",
      label: "На этой неделе",
      tasks: viewTasks.filter((task) => groupForTask(task) === "week"),
    },
    {
      key: "later",
      label: "Позже",
      tasks: viewTasks.filter((task) => groupForTask(task) === "later"),
    },
  ].filter((group) => group.tasks.length);
  const groupCount = (key: string) =>
    groups.find((group) => group.key === key)?.tasks.length ?? 0;
  return (
    <div className="tasks-page">
      <header className="tasks-header">
        <h1>Задачи</h1>
        <span className="header-spacer" />
        <span className="tasks-total">
          Показано {rows.length} из {totalCount}
        </span>
      </header>
      <div className="tasks-filterbar">
        <span className="filter-chip">Ответственный: {profile.full_name}</span>
        <span className="header-spacer" />
        <span className="task-counter danger">
          <i />
          Просрочено {groupCount("overdue")}
        </span>
        <span className="task-counter blue">
          <i />
          Сегодня {groupCount("today")}
        </span>
        <span className="task-counter">
          <i />
          Завтра {groupCount("tomorrow")}
        </span>
      </div>
      <main className="task-list">
        {groups.map((group) => (
          <section className="task-group" key={group.key}>
            <div
              className={`task-group-header ${group.tone === "danger" ? "is-danger" : ""}`}
            >
              <span>{group.label}</span>
              <b>{group.tasks.length}</b>
            </div>
            {group.tasks.map((task) => (
              <div className="task-row" key={task.id}>
                <TaskCompletion taskId={task.id} />
                <span className="task-type" title={task.typeName}>
                  {task.typeName.slice(0, 1)}
                </span>
                <span className="task-main">
                  <strong>
                    {task.title?.trim() || `${task.typeName} — без названия`}
                  </strong>
                  <span>
                    {task.deal_id ? (
                      <a href={`/deals/${task.deal_id}`}>{task.contactName}</a>
                    ) : (
                      task.contactName
                    )}
                    <em>·</em>
                    {task.stageName}
                  </span>
                </span>
                <span
                  className={`task-due ${task.overdueLabel ? "is-overdue" : ""}`}
                >
                  {task.overdueLabel ?? task.dueLabel}
                </span>
                <span className="task-avatar" title={task.assigneeName}>
                  {initials(task.assigneeName)}
                </span>
              </div>
            ))}
          </section>
        ))}
        {!groups.length && <div className="tasks-empty">Задач пока нет</div>}
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
