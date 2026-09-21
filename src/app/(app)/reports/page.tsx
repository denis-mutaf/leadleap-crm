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
type CountRow = DictionaryRow & { count: number };
type ReportSnapshot = {
  total: number;
  open: number;
  won: number;
  lost: number;
  stage_counts: Record<string, number>;
  source_counts: Record<string, number>;
  reason_counts: Record<string, number>;
  source_without_value: number;
  reason_without_value: number;
};

function isNumberRecord(value: unknown): value is Record<string, number> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every(
      (item) => typeof item === "number" && Number.isInteger(item) && item >= 0,
    )
  );
}

function isReportSnapshot(value: unknown): value is ReportSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    [
      "total",
      "open",
      "won",
      "lost",
      "source_without_value",
      "reason_without_value",
    ].every(
      (key) =>
        typeof record[key] === "number" &&
        Number.isInteger(record[key]) &&
        (record[key] as number) >= 0,
    ) &&
    isNumberRecord(record.stage_counts) &&
    isNumberRecord(record.source_counts) &&
    isNumberRecord(record.reason_counts)
  );
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
  const snapshotResult = await supabase.rpc("crm_report_snapshot");
  if (snapshotResult.error || !isReportSnapshot(snapshotResult.data)) {
    return (
      <div className="reports-page">
        <header className="reports-header">
          <div>
            <p className="reports-eyebrow">Сводка отдела</p>
            <h1>Отчёты</h1>
          </div>
        </header>
        <section className="reports-access">
          <Info size={20} />
          <div>
            <strong>Сводка временно недоступна</strong>
            <p>
              Не удалось получить согласованный снимок данных. Проверьте
              соединение и повторите попытку.
            </p>
            <a href="/reports">Повторить</a>
          </div>
        </section>
      </div>
    );
  }
  const snapshot = snapshotResult.data;
  const {
    total,
    open,
    won,
    lost,
    stage_counts,
    source_counts,
    reason_counts,
    source_without_value,
    reason_without_value,
  } = snapshot;
  const stageCounts = openStages.map((stage) => ({
    ...stage,
    count: stage_counts[stage.id] ?? 0,
  }));
  const sourceCounts = sources.map((source) => ({
    ...source,
    count: source_counts[source.id] ?? 0,
  }));
  const reasonCounts = reasons.map((reason) => ({
    ...reason,
    count: reason_counts[reason.id] ?? 0,
  }));
  const stageTotal = stageCounts.reduce((sum, stage) => sum + stage.count, 0);
  const reasonTotal = reasonCounts.reduce(
    (sum, reason) => sum + reason.count,
    0,
  );
  const stageResidual = open - stageTotal;
  const reasonResidual = lost - reasonTotal - reason_without_value;
  const maxStageCount = Math.max(1, ...stageCounts.map((stage) => stage.count));
  const sourceRows: CountRow[] = [
    ...sourceCounts,
    ...(source_without_value
      ? [
          {
            id: "no-source",
            name: "Без источника",
            count: source_without_value,
          },
        ]
      : []),
  ].filter((row) => row.count > 0);
  const reasonRows: CountRow[] = [
    ...reasonCounts,
    ...(reason_without_value
      ? [
          {
            id: "no-reason",
            name: "Без причины отказа",
            count: reason_without_value,
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
