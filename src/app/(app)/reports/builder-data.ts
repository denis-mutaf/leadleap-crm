import "server-only";

import { getCurrentProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const TIME_ZONE = "Europe/Chisinau";
const PAGE_SIZE = 1000;
const EUR = "EUR";
type Period = "month" | "quarter" | "year";
export type Amount = { sum: number; knownCount: number; totalCount: number };
type Deal = {
  id: string;
  created_at: string;
  stage_id: string;
  status: string;
  budget: number | string | null;
  budget_currency: string | null;
};
type Project = { id: string; name: string };
type Link = { deal_id: string; project_id: string };
type Transition = {
  id: string;
  deal_id: string;
  to_stage_id: string;
  changed_at: string;
};
type Stage = {
  id: string;
  name: string;
  kind: string;
  is_active: boolean;
  import_key: string | null;
  position: number;
};
type QueryResult<T> = { data: T[] | null; error: { message: string } | null };
export type BuilderDashboard = {
  period: Period;
  periodLabel: string;
  asOf: string;
  metrics: {
    reservations: number;
    reservationAmount: Amount;
    contracts: number;
    contractAmount: Amount;
    daysToReservation: number | null;
  };
  projects: Array<{
    id: string;
    name: string;
    inquiries: number;
    meetings: number;
    reservations: number;
    reservationAmount: Amount;
    contracts: number;
    contractAmount: Amount;
  }>;
  stageBars: Array<{ name: string; count: number }>;
  openTotal: number;
  reservationRows: Array<{
    id: string;
    object: string;
    project: string;
    amount: number | null;
    currency: string;
    date: string;
  }>;
  dataNote?: string[];
};

function dateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.get("year") ?? 0,
    month: values.get("month") ?? 0,
    day: values.get("day") ?? 0,
  };
}

function localDateToUtc(year: number, month: number, day: number) {
  const utcNoon = new Date(Date.UTC(year, month - 1, day, 12));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    timeZoneName: "shortOffset",
  }).formatToParts(utcNoon);
  const offsetPart =
    parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = offsetPart.match(/^GMT(?:([-+])(\d{1,2})(?::(\d{2}))?)?$/);
  if (!match)
    throw new Error(
      `Не удалось определить смещение часового пояса: ${offsetPart}`,
    );
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const offsetMinutes = sign * (hours * 60 + minutes);
  return new Date(Date.UTC(year, month - 1, day) - offsetMinutes * 60 * 1000);
}

function bounds(period: Period) {
  const now = dateParts(new Date());
  const firstMonth =
    period === "year"
      ? 1
      : period === "quarter"
        ? Math.floor((now.month - 1) / 3) * 3 + 1
        : now.month;
  const increment = period === "quarter" ? 3 : 1;
  const nextAbsoluteMonth = firstMonth + (period === "year" ? 12 : increment);
  return {
    start: localDateToUtc(now.year, firstMonth, 1),
    end: localDateToUtc(
      now.year + Math.floor((nextAbsoluteMonth - 1) / 12),
      ((nextAbsoluteMonth - 1) % 12) + 1,
      1,
    ),
    year: now.year,
    firstMonth,
  };
}

function inRange(value: string, start: Date, end: Date) {
  const time = new Date(value).getTime();
  return (
    Number.isFinite(time) && time >= start.getTime() && time < end.getTime()
  );
}

function dealAmount(deal: Deal | undefined) {
  if (
    !deal ||
    deal.budget == null ||
    (deal.budget_currency ?? "").toUpperCase() !== EUR
  )
    return null;
  const value = Number(deal.budget);
  return Number.isFinite(value) ? value : null;
}

async function page<T>(
  query: (cursor: string) => PromiseLike<QueryResult<T>>,
  label: string,
  cursorOf: (row: T) => string,
) {
  const rows: T[] = [];
  let cursor = "";
  for (;;) {
    const result = await query(cursor);
    if (result.error) throw new Error(`${label}: ${result.error.message}`);
    const batch = result.data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
    const nextCursor = cursorOf(batch[batch.length - 1]);
    if (!nextCursor || nextCursor === cursor)
      throw new Error(`${label}: pagination cursor did not advance`);
    cursor = nextCursor;
  }
}

function uniqueTransitions(rows: Transition[]) {
  const result = new Map<string, Transition>();
  for (const row of rows) {
    const previous = result.get(row.deal_id);
    if (
      !previous ||
      row.changed_at < previous.changed_at ||
      (row.changed_at === previous.changed_at && row.id < previous.id)
    )
      result.set(row.deal_id, row);
  }
  return [...result.values()].sort(
    (a, b) =>
      b.changed_at.localeCompare(a.changed_at) || a.id.localeCompare(b.id),
  );
}

function sumAmount(rows: Transition[], deals: Map<string, Deal>): Amount {
  let sum = 0;
  let knownCount = 0;
  for (const row of rows) {
    const value = dealAmount(deals.get(row.deal_id));
    if (value != null) {
      sum += value;
      knownCount += 1;
    }
  }
  return { sum, knownCount, totalCount: rows.length };
}

export async function loadBuilderDashboard(
  period: Period,
): Promise<BuilderDashboard> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "builder")
    throw new Error("Отчёт доступен только активному застройщику");
  const supabase = createAdminClient();
  const range = bounds(period);
  const [stageResult, projectResult] = await Promise.all([
    supabase
      .from("stages")
      .select("id,name,kind,is_active,import_key,position")
      .order("position")
      .order("id"),
    supabase.from("projects").select("id,name").order("position").order("id"),
  ]);
  if (stageResult.error) throw new Error(`Этапы: ${stageResult.error.message}`);
  if (projectResult.error)
    throw new Error(`Проекты: ${projectResult.error.message}`);
  const stages = (stageResult.data ?? []) as Stage[];
  const projects = (projectResult.data ?? []) as Project[];
  const stageByKey = new Map(
    stages
      .filter((stage) => stage.import_key)
      .map((stage) => [stage.import_key as string, stage]),
  );
  const reservationStage = stageByKey.get("amo:stage:90");
  const contractStage = stageByKey.get("amo:stage:110");
  const meetingStageIds = new Set(
    ["amo:stage:50", "amo:stage:60", "amo:stage:70"]
      .map((key) => stageByKey.get(key)?.id)
      .filter((id): id is string => Boolean(id)),
  );
  if (!reservationStage || !contractStage || meetingStageIds.size === 0)
    throw new Error("Не найдены обязательные этапы amo по import_key");
  const [deals, links, transitions] = await Promise.all([
    page<Deal>(
      (cursor) =>
        supabase
          .from("deals")
          .select("id,created_at,stage_id,status,budget,budget_currency")
          .is("deleted_at", null)
          .gt("id", cursor || "00000000-0000-0000-0000-000000000000")
          .order("id")
          .limit(PAGE_SIZE),
      "Сделки",
      (row) => row.id,
    ),
    page<Link>(
      (cursor) => {
        const [dealId, projectId] = cursor
          ? cursor.split("|")
          : [
              "00000000-0000-0000-0000-000000000000",
              "00000000-0000-0000-0000-000000000000",
            ];
        return supabase
          .from("deal_projects")
          .select("deal_id,project_id")
          .or(
            `deal_id.gt.${dealId},and(deal_id.eq.${dealId},project_id.gt.${projectId})`,
          )
          .order("deal_id")
          .order("project_id")
          .limit(PAGE_SIZE);
      },
      "Связи сделок и проектов",
      (row) => `${row.deal_id}|${row.project_id}`,
    ),
    page<Transition>(
      (cursor) =>
        supabase
          .from("stage_transitions")
          .select("id,deal_id,to_stage_id,changed_at")
          .gte("changed_at", range.start.toISOString())
          .lt("changed_at", range.end.toISOString())
          .gt("id", cursor || "00000000-0000-0000-0000-000000000000")
          .order("id")
          .limit(PAGE_SIZE),
      "Переходы этапов",
      (row) => row.id,
    ),
  ]);
  return buildDashboard(
    period,
    range,
    stages,
    projects,
    deals,
    links,
    transitions,
    reservationStage.id,
    contractStage.id,
    meetingStageIds,
  );
}

function buildDashboard(
  period: Period,
  range: ReturnType<typeof bounds>,
  stages: Stage[],
  projects: Project[],
  deals: Deal[],
  links: Link[],
  transitions: Transition[],
  reservationStageId: string,
  contractStageId: string,
  meetingStageIds: Set<string>,
): BuilderDashboard {
  const dealById = new Map(deals.map((deal) => [deal.id, deal]));
  const linksByDeal = new Map<string, string[]>();
  for (const link of links)
    if (dealById.has(link.deal_id))
      linksByDeal.set(link.deal_id, [
        ...(linksByDeal.get(link.deal_id) ?? []),
        link.project_id,
      ]);
  const reservationTransitions = uniqueTransitions(
    transitions.filter(
      (row) =>
        dealById.has(row.deal_id) && row.to_stage_id === reservationStageId,
    ),
  );
  const contractTransitions = uniqueTransitions(
    transitions.filter(
      (row) => dealById.has(row.deal_id) && row.to_stage_id === contractStageId,
    ),
  );
  const meetingTransitions = uniqueTransitions(
    transitions.filter(
      (row) =>
        dealById.has(row.deal_id) && meetingStageIds.has(row.to_stage_id),
    ),
  );
  const createRow = (id: string, name: string) => ({
    id,
    name,
    inquiries: 0,
    meetings: 0,
    reservations: 0,
    reservationAmount: { sum: 0, knownCount: 0, totalCount: 0 },
    contracts: 0,
    contractAmount: { sum: 0, knownCount: 0, totalCount: 0 },
  });
  const projectRows = projects.map((project) =>
    createRow(project.id, project.name),
  );
  const rowById = new Map(projectRows.map((row) => [row.id, row]));
  const unlinked = createRow("unlinked", "Без площадки");
  const rowsForDeal = (dealId: string) => {
    const rows = (linksByDeal.get(dealId) ?? [])
      .map((id) => rowById.get(id))
      .filter((row): row is (typeof projectRows)[number] => Boolean(row));
    return rows.length > 0 ? rows : [unlinked];
  };
  for (const deal of deals)
    if (inRange(deal.created_at, range.start, range.end))
      for (const row of rowsForDeal(deal.id)) row.inquiries += 1;
  for (const transition of meetingTransitions)
    for (const row of rowsForDeal(transition.deal_id)) row.meetings += 1;
  for (const transition of reservationTransitions)
    for (const row of rowsForDeal(transition.deal_id)) {
      row.reservations += 1;
      row.reservationAmount.totalCount += 1;
      const value = dealAmount(dealById.get(transition.deal_id));
      if (value != null) {
        row.reservationAmount.sum += value;
        row.reservationAmount.knownCount += 1;
      }
    }
  for (const transition of contractTransitions)
    for (const row of rowsForDeal(transition.deal_id)) {
      row.contracts += 1;
      row.contractAmount.totalCount += 1;
      const value = dealAmount(dealById.get(transition.deal_id));
      if (value != null) {
        row.contractAmount.sum += value;
        row.contractAmount.knownCount += 1;
      }
    }
  const days = reservationTransitions
    .map((transition) => {
      const created = dealById.get(transition.deal_id)?.created_at;
      if (!created) return null;
      const value =
        (new Date(transition.changed_at).getTime() -
          new Date(created).getTime()) /
        86400000;
      return Number.isFinite(value) && value >= 0 ? value : null;
    })
    .filter((value): value is number => value != null);
  const projectName = (dealId: string) =>
    rowsForDeal(dealId)
      .map((row) => row.name)
      .join(", ");
  const periodLabel =
    period === "year"
      ? `${range.year}`
      : period === "quarter"
        ? `${range.year}, кв. ${Math.floor((range.firstMonth - 1) / 3) + 1}`
        : new Intl.DateTimeFormat("ru-RU", {
            month: "long",
            year: "numeric",
            timeZone: TIME_ZONE,
          }).format(range.start);
  const openStageCounts = new Map<string, number>();
  for (const deal of deals) {
    if (deal.status === "open" || deal.status === "postponed") {
      openStageCounts.set(
        deal.stage_id,
        (openStageCounts.get(deal.stage_id) ?? 0) + 1,
      );
    }
  }
  const stageBars = stages
    .filter((stage) => stage.kind === "open" && stage.is_active)
    .map((stage) => ({
      name: stage.name,
      count: openStageCounts.get(stage.id) ?? 0,
    }));
  const openTotal = deals.reduce(
    (count, deal) =>
      count + (deal.status === "open" || deal.status === "postponed" ? 1 : 0),
    0,
  );
  const stageBarTotal = stageBars.reduce((sum, row) => sum + row.count, 0);
  const dataNote = [
    "Суммы учитываются только для бюджетов в EUR; известные значения показываются отдельно.",
    "Сумма использует текущий бюджет сделки в EUR; схема не хранит цену на момент перехода, поэтому это не историческая цена.",
    "Сделка может быть посчитана в нескольких проектах; суммы строк проектов могут перекрываться.",
    "Неактивные или неизвестные проекты отображаются как «Без площадки».",
  ];
  if (openTotal !== stageBarTotal) {
    dataNote.push(
      `Открытых/отложенных сделок: ${openTotal}; по активным открытым этапам: ${stageBarTotal}; остаток: ${openTotal - stageBarTotal}.`,
    );
  }
  return {
    period,
    periodLabel,
    asOf: new Date().toISOString(),
    metrics: {
      reservations: reservationTransitions.length,
      reservationAmount: sumAmount(reservationTransitions, dealById),
      contracts: contractTransitions.length,
      contractAmount: sumAmount(contractTransitions, dealById),
      daysToReservation: days.length
        ? Math.round(days.reduce((sum, value) => sum + value, 0) / days.length)
        : null,
    },
    projects: [...projectRows, unlinked],
    stageBars,
    openTotal,
    reservationRows: reservationTransitions.slice(0, 20).map((row) => ({
      id: row.deal_id,
      object: "Резервация",
      project: projectName(row.deal_id),
      amount: dealAmount(dealById.get(row.deal_id)),
      currency: "EUR",
      date: row.changed_at,
    })),
    dataNote,
  };
}
