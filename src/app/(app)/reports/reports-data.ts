import { createClient } from "@/lib/supabase/server";

// Отчёты за период: параметры в URL, расчёт в БД (crm_report_period / crm_report_cohorts).
// Даты периода — календарные дни Europe/Chisinau, обе границы включительно.

export type PeriodKind = "week" | "month" | "quarter" | "custom";
export type ReportTab = "period" | "snapshot";

export type ReportParams = {
  tab: ReportTab;
  period: PeriodKind;
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  source: string | null;
  manager: string | null;
  project: string | null;
};

type SearchValue = string | string[] | undefined;
export type ReportSearchParams = Record<string, SearchValue>;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const one = (value: SearchValue) => (Array.isArray(value) ? value[0] : value);

export function todayInChisinau(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Chisinau",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

const asDate = (day: string) => new Date(`${day}T12:00:00Z`);
const asDay = (date: Date) => date.toISOString().slice(0, 10);

export function addDays(day: string, days: number) {
  const date = asDate(day);
  date.setUTCDate(date.getUTCDate() + days);
  return asDay(date);
}

function daysBetween(from: string, to: string) {
  return Math.round((asDate(to).getTime() - asDate(from).getTime()) / 86_400_000);
}

function isRealDay(value: string | undefined): value is string {
  return !!value && DAY_RE.test(value) && asDay(asDate(value)) === value;
}

// Начало месяца со сдвигом в месяцах и тот же день месяца (обрезанный по длине месяца).
function shiftMonths(day: string, months: number) {
  const [y, m, d] = day.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1, 12));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return asDay(target);
}

export function resolvePeriod(
  kind: PeriodKind,
  fromParam: string | undefined,
  toParam: string | undefined,
  today: string,
) {
  const monthStart = `${today.slice(0, 8)}01`;
  if (kind === "week") {
    const weekday = (asDate(today).getUTCDay() + 6) % 7; // понедельник = 0
    const from = addDays(today, -weekday);
    return { from, to: today, prevFrom: addDays(from, -7), prevTo: addDays(today, -7) };
  }
  if (kind === "quarter") {
    const month = Number(today.slice(5, 7));
    const from = `${today.slice(0, 5)}${String(Math.floor((month - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
    return {
      from,
      to: today,
      prevFrom: shiftMonths(from, -3),
      prevTo: shiftMonths(today, -3),
    };
  }
  if (kind === "custom" && isRealDay(fromParam) && isRealDay(toParam)) {
    const [from, to] = fromParam <= toParam ? [fromParam, toParam] : [toParam, fromParam];
    const length = daysBetween(from, to) + 1;
    const prevTo = addDays(from, -1);
    return { from, to, prevFrom: addDays(prevTo, -(length - 1)), prevTo };
  }
  return {
    from: monthStart,
    to: today,
    prevFrom: shiftMonths(monthStart, -1),
    prevTo: shiftMonths(today, -1),
  };
}

function filterValue(value: SearchValue) {
  const raw = one(value);
  if (raw === "none") return "none";
  return raw && UUID_RE.test(raw) ? raw.toLowerCase() : null;
}

export function parseReportParams(
  search: ReportSearchParams | undefined,
  now = new Date(),
): ReportParams {
  const today = todayInChisinau(now);
  const rawPeriod = one(search?.period);
  const requested: PeriodKind =
    rawPeriod === "week" || rawPeriod === "quarter" || rawPeriod === "custom"
      ? rawPeriod
      : "month";
  const range = resolvePeriod(requested, one(search?.from), one(search?.to), today);
  // «Свой» без корректных дат — тот же месяц, что и по умолчанию.
  const period: PeriodKind =
    requested === "custom" &&
    !(isRealDay(one(search?.from)) && isRealDay(one(search?.to)))
      ? "month"
      : requested;
  return {
    tab: one(search?.tab) === "snapshot" ? "snapshot" : "period",
    period,
    ...range,
    source: filterValue(search?.source),
    manager: filterValue(search?.manager),
    project: filterValue(search?.project),
  };
}

// ---------- ответ БД ----------

export type StageRow = {
  id: string;
  name: string;
  position: number;
  kind: "open" | "won";
  entered: number;
  reached: Record<string, number>;
};
export type SegmentRow = {
  key: string;
  name: string | null;
  obr: number;
  answered: number;
  met: number;
  resv: number;
  conv: number;
};
export type ManagerRow = {
  key: string;
  name: string | null;
  obr: number;
  met: number;
  resv: number;
  measured: number;
  median_min: number | null;
  overdue: number;
  no_next: number;
};
export type ReasonRow = { key: string; name: string | null; n: number };
export type Pair = { cur: number; prev: number };
export type PeriodReport = {
  generated_at: string;
  widgets: {
    new: Pair;
    answered: Pair & { of_cur: number; of_prev: number };
    meetings: Pair;
    reservations: Pair & { sum_cur: number; sum_prev: number; known_cur: number };
  };
  stages: StageRow[];
  sources: SegmentRow[];
  projects: SegmentRow[];
  managers: ManagerRow[];
  reasons: ReasonRow[];
};
export type CohortRow = {
  month: string;
  n: number;
  r3: number | null;
  r6: number | null;
  r12: number | null;
  fallback: number;
};

function isPeriodReport(value: unknown): value is PeriodReport {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.widgets === "object" &&
    v.widgets !== null &&
    Array.isArray(v.stages) &&
    Array.isArray(v.sources) &&
    Array.isArray(v.projects) &&
    Array.isArray(v.managers) &&
    Array.isArray(v.reasons)
  );
}

export type Option = { id: string; name: string };
export type PeriodReportData = {
  report: PeriodReport;
  /** null — когорты не посчитались (ошибка или таймаут); остальной отчёт при этом показывается. */
  cohorts: CohortRow[] | null;
  sources: Option[];
  projects: Option[];
  managers: Option[];
};

// Одна загрузка на страницу и на CSV-экспорт: те же две RPC и справочники для фильтров.
export async function loadPeriodReport(
  params: ReportParams,
): Promise<PeriodReportData> {
  const supabase = await createClient();
  const rpcFilters = {
    p_source: params.source,
    p_manager: params.manager,
    p_project: params.project,
  };
  const [reportResult, cohortResult, sourcesResult, projectsResult, managersResult] =
    await Promise.all([
      supabase.rpc("crm_report_period", {
        p_from: params.from,
        p_to: params.to,
        p_prev_from: params.prevFrom,
        p_prev_to: params.prevTo,
        ...rpcFilters,
      }),
      supabase.rpc("crm_report_cohorts", rpcFilters),
      supabase.from("sources").select("id, name").order("name"),
      supabase.from("projects").select("id, name").order("name"),
      supabase
        .from("profiles")
        .select("id, full_name")
        .in("role", ["manager", "head", "admin"])
        .eq("is_active", true)
        .order("full_name"),
    ]);
  if (reportResult.error)
    throw new Error(`Отчёт за период: ${reportResult.error.message}`);
  if (!isPeriodReport(reportResult.data))
    throw new Error("Отчёт за период: неожиданный ответ базы");
  return {
    report: reportResult.data,
    cohorts: cohortResult.error ? null : ((cohortResult.data ?? []) as CohortRow[]),
    sources: (sourcesResult.data ?? []) as Option[],
    projects: (projectsResult.data ?? []) as Option[],
    managers: ((managersResult.data ?? []) as { id: string; full_name: string | null }[]).map(
      (row) => ({ id: row.id, name: row.full_name ?? "Без имени" }),
    ),
  };
}

// ---------- производные величины (общие для экрана и CSV) ----------

export const NO_SOURCE = "Источник: не указан";
export const NO_PROJECT = "Проект: не указан";
export const NO_MANAGER = "Без менеджера";

export const sourceLabel = (row: SegmentRow) =>
  row.key === "none" ? NO_SOURCE : (row.name ?? "Источник удалён");
export const projectLabel = (row: SegmentRow) =>
  row.key === "none" ? NO_PROJECT : (row.name ?? "Проект удалён");
export const managerLabel = (row: ManagerRow) =>
  row.key === "none" ? NO_MANAGER : (row.name ?? "Без имени");

export const percent = (value: number, total: number) =>
  total > 0 ? (value / total) * 100 : null;

export const MIN_MEASURED = 5;
export const MIN_COVERAGE = 0.5;

// «Первый ответ» показываем, только если первое действие найдено хотя бы у половины сделок
// менеджера и их не меньше пяти: переписка Amo в базу не перенесена, поэтому у части сделок
// исходящее сообщение просто не видно, и медиана по остальным была бы оптимистичной.
export function firstResponse(row: ManagerRow) {
  const coverage = row.obr > 0 ? row.measured / row.obr : 0;
  if (row.measured >= MIN_MEASURED && coverage >= MIN_COVERAGE && row.median_min != null) {
    return { value: row.median_min, note: null as string | null };
  }
  const why =
    row.obr === 0
      ? "Нет новых сделок за период."
      : `Первое действие найдено у ${row.measured} из ${row.obr} сделок: переписка Amo в CRM не перенесена, медиана по такой выборке была бы неверной.`;
  return { value: null, note: why };
}

export function formatDuration(minutes: number) {
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} мин`;
  if (minutes < 60 * 48) {
    const hours = minutes / 60;
    return `${hours >= 10 ? Math.round(hours) : hours.toFixed(1).replace(".", ",")} ч`;
  }
  return `${Math.round(minutes / 1440)} дн`;
}

export function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
    .format(new Date(Date.UTC(y, m - 1, 1)))
    .replace(/\s*г\./, "");
}

export function periodLabel(from: string, to: string) {
  const fmt = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const a = asDate(from);
  const b = asDate(to);
  const text = (date: Date) => fmt.format(date).replace(/\s*г\./, "");
  if (from === to) return text(a);
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  if (sameMonth) {
    return `${a.getUTCDate()} — ${text(b)}`;
  }
  return `${text(a)} — ${text(b)}`;
}

// Query-строка текущего состояния экрана с правками: для ссылок периода, вкладок и экспорта.
export function reportQuery(
  params: ReportParams,
  patch: Partial<{
    tab: ReportTab;
    period: PeriodKind;
    from: string;
    to: string;
  }> = {},
) {
  const tab = patch.tab ?? params.tab;
  const period = patch.period ?? params.period;
  const query = new URLSearchParams();
  if (tab === "snapshot") query.set("tab", "snapshot");
  if (tab === "period") {
    query.set("period", period);
    if (period === "custom") {
      query.set("from", patch.from ?? params.from);
      query.set("to", patch.to ?? params.to);
    }
    if (params.source) query.set("source", params.source);
    if (params.project) query.set("project", params.project);
    if (params.manager) query.set("manager", params.manager);
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}
