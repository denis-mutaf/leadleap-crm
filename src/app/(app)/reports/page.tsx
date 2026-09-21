import { Database, Info } from "lucide-react";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { BuilderDashboard } from "./builder-dashboard";
import { loadBuilderDashboard } from "./builder-data";

type Period = "month" | "quarter" | "year";
type ReportsSearchParams = Promise<{
  period?: string | string[];
}>;

function parsePeriod(value: string | string[] | undefined): Period {
  const period = Array.isArray(value) ? value[0] : value;
  return period === "quarter" || period === "year" ? period : "month";
}

type DictionaryRow = {
  id: string;
  name: string;
  position?: number;
  kind?: string;
};
type Filter = {
  column: "status" | "stage_id" | "source_id" | "lost_reason_id";
  operator: "eq" | "in" | "is";
  value: string | string[] | null;
};
type CountRow = DictionaryRow & { count: number };

async function countDeals(
  supabase: Awaited<ReturnType<typeof createClient>>,
  filters?: Filter | Filter[],
) {
  let query = supabase
    .from("deals")
    .select("id", { count: "exact", head: true });
  for (const filter of filters
    ? Array.isArray(filters)
      ? filters
      : [filters]
    : []) {
    if (filter.operator === "eq")
      query = query.eq(filter.column, filter.value as string);
    if (filter.operator === "in")
      query = query.in(filter.column, filter.value as string[]);
    if (filter.operator === "is") query = query.is(filter.column, null);
  }
  const result = await query;
  if (result.error) throw new Error(`Сделки: ${result.error.message}`);
  return result.count ?? 0;
}

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
) {
  const result: R[] = [];
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      result[index] = await task(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return result;
}

function percent(value: number, denominator: number) {
  return denominator ? `${((value / denominator) * 100).toFixed(1)}%` : "—";
}

function snapshotDate() {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Chisinau",
  }).format(new Date());
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams?: ReportsSearchParams;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role === "manager") redirect("/deals");
  if (profile.role === "builder") {
    const params = searchParams ? await searchParams : undefined;
    const data = await loadBuilderDashboard(parsePeriod(params?.period));
    return (
      <BuilderDashboard
        data={{
          ...data,
          exportHref: `/api/reports/builder-export?period=${data.period}`,
        }}
      />
    );
  }

  const supabase = await createClient();
  const [stagesResult, sourcesResult, reasonsResult] = await Promise.all([
    supabase
      .from("stages")
      .select("id, name, position, kind")
      .order("position"),
    supabase.from("sources").select("id, name").order("name"),
    supabase
      .from("lost_reasons")
      .select("id, name, position")
      .order("position"),
  ]);
  if (stagesResult.error)
    throw new Error(`Этапы: ${stagesResult.error.message}`);
  if (sourcesResult.error)
    throw new Error(`Источники: ${sourcesResult.error.message}`);
  if (reasonsResult.error)
    throw new Error(`Причины отказа: ${reasonsResult.error.message}`);
  const stages = (stagesResult.data ?? []) as DictionaryRow[];
  const openStages = stages.filter((stage) => stage.kind === "open");
  const sources = (sourcesResult.data ?? []) as DictionaryRow[];
  const reasons = (reasonsResult.data ?? []) as DictionaryRow[];
  const openFilter: Filter = {
    column: "status",
    operator: "in",
    value: ["open", "postponed"],
  };
  const [total, open, won, lost] = await Promise.all([
    countDeals(supabase),
    countDeals(supabase, openFilter),
    countDeals(supabase, { column: "status", operator: "eq", value: "won" }),
    countDeals(supabase, { column: "status", operator: "eq", value: "lost" }),
  ]);
  const [
    stageCounts,
    sourceCounts,
    reasonCounts,
    sourceWithoutValue,
    reasonWithoutValue,
  ] = await Promise.all([
    mapWithLimit(openStages, 4, async (stage) => ({
      ...stage,
      count: await countDeals(supabase, [
        { column: "stage_id", operator: "eq", value: stage.id },
        openFilter,
      ]),
    })),
    mapWithLimit(sources, 4, async (source) => ({
      ...source,
      count: await countDeals(supabase, {
        column: "source_id",
        operator: "eq",
        value: source.id,
      }),
    })),
    mapWithLimit(reasons, 4, async (reason) => ({
      ...reason,
      count: await countDeals(supabase, [
        { column: "lost_reason_id", operator: "eq", value: reason.id },
        { column: "status", operator: "eq", value: "lost" },
      ]),
    })),
    countDeals(supabase, { column: "source_id", operator: "is", value: null }),
    countDeals(supabase, [
      { column: "lost_reason_id", operator: "is", value: null },
      { column: "status", operator: "eq", value: "lost" },
    ]),
  ]);
  const stageTotal = stageCounts.reduce((sum, stage) => sum + stage.count, 0);
  const reasonTotal = reasonCounts.reduce(
    (sum, reason) => sum + reason.count,
    0,
  );
  const stageResidual = open - stageTotal;
  const reasonResidual = lost - reasonTotal - reasonWithoutValue;
  const maxStageCount = Math.max(1, ...stageCounts.map((stage) => stage.count));
  const sourceRows: CountRow[] = [
    ...sourceCounts,
    ...(sourceWithoutValue
      ? [{ id: "no-source", name: "Без источника", count: sourceWithoutValue }]
      : []),
  ].filter((row) => row.count > 0);
  const reasonRows: CountRow[] = [
    ...reasonCounts,
    ...(reasonWithoutValue
      ? [
          {
            id: "no-reason",
            name: "Без причины отказа",
            count: reasonWithoutValue,
          },
        ]
      : []),
  ].filter((row) => row.count > 0);
  if (reasonResidual !== 0) {
    reasonRows.push({
      id: "unmatched-reason",
      name:
        reasonResidual > 0
          ? "Не сопоставлено с причиной"
          : "Проверка причин: расхождение",
      count: Math.abs(reasonResidual),
    });
  }

  return (
    <div className="reports-page">
      <header className="reports-header">
        <div>
          <p className="reports-eyebrow">Сводка отдела</p>
          <h1>Отчёты</h1>
        </div>
        <span className="snapshot-label">
          <Database size={14} /> Текущий снимок · {snapshotDate()}
        </span>
      </header>
      <div className="reports-note">
        <Info size={16} /> Остатки сделок показывают текущее состояние базы, а
        не конверсию между этапами.
      </div>
      <section className="report-metrics" aria-label="Итоги сделок">
        {[
          ["Всего сделок", total],
          ["Открытые", open],
          ["Выигранные", won],
          ["Проигранные", lost],
        ].map(([label, value]) => (
          <article className="report-metric" key={label as string}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>
      <section className="report-section">
        <div className="report-section-title">
          <div>
            <h2>Открытые сделки по этапам</h2>
            <p>
              Доля рассчитана от {open} открытых и отложенных сделок · текущий
              остаток
            </p>
          </div>
        </div>
        <div className="stage-list">
          {stageCounts.map((stage) => (
            <div className="stage-row" key={stage.id}>
              <span className="stage-name">{stage.name}</span>
              <div className="stage-track">
                <i
                  style={{ width: `${(stage.count / maxStageCount) * 100}%` }}
                />
                <b>{stage.count}</b>
              </div>
              <span className="stage-percent">
                {percent(stage.count, open)}
              </span>
            </div>
          ))}
          {stageResidual !== 0 && (
            <div className="stage-residual" role="status">
              {stageResidual > 0
                ? `${stageResidual} сделок не сопоставлено с открытым этапом.`
                : `Проверка этапов: распределено на ${Math.abs(stageResidual)} сделок больше, чем открыто.`}
            </div>
          )}
        </div>
      </section>
      <div className="report-grid">
        <section className="report-section">
          <h2>Источники</h2>
          <p className="section-subtitle">
            Все сделки, включая исторические значения справочника
          </p>
          <div className="simple-list">
            {sourceRows.length ? (
              sourceRows.map((row) => (
                <div className="simple-row" key={row.id}>
                  <span>{row.name}</span>
                  <strong>{row.count}</strong>
                  <em>{percent(row.count, total)}</em>
                </div>
              ))
            ) : (
              <p className="empty-report">
                Нет доступных данных по источникам.
              </p>
            )}
          </div>
        </section>
        <section className="report-section">
          <h2>Причины отказа</h2>
          <p className="section-subtitle">
            Все проигранные сделки, включая незаполненные причины
          </p>
          <div className="simple-list">
            {reasonRows.length ? (
              reasonRows.map((row) => (
                <div className="simple-row" key={row.id}>
                  <span>{row.name}</span>
                  <strong>{row.count}</strong>
                  <em>{percent(row.count, lost)}</em>
                </div>
              ))
            ) : (
              <p className="empty-report">Нет доступных данных по причинам.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
