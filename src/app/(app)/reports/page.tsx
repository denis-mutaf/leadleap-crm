import { Database, Info } from "lucide-react";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { StageIndicator } from "@/components/crm/stage-indicator";
import { BuilderDashboard } from "./builder-dashboard";
import { loadBuilderDashboard } from "./builder-data";
import styles from "./reports.module.css";

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
  channel_counts: Record<string, number>;
  channel_unknown: number;
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
      "channel_unknown",
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
    isNumberRecord(record.reason_counts) &&
    isNumberRecord(record.channel_counts)
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
    channel_counts,
    channel_unknown,
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
  // Справочник источников в Amo не заполнялся: source_id = null у всех сделок.
  // Пока в нём нет ни одного значения, показывать «Без источника — 100%» бессмысленно —
  // отчёт строится по меткам канала, которыми отдел размечает сделки на самом деле.
  const dictionarySources = sourceCounts.filter((row) => row.count > 0);
  const channelRows: CountRow[] = [
    ...Object.entries(channel_counts).map(([name, count]) => ({
      id: name,
      name,
      count,
    })),
    ...(channel_unknown
      ? [{ id: "no-channel", name: "Канал не размечен", count: channel_unknown }]
      : []),
  ]
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count);
  const usingChannels = dictionarySources.length === 0;
  const sourceRows: CountRow[] = usingChannels
    ? channelRows
    : [
        ...dictionarySources,
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
  ]
    .filter((row) => row.count > 0)
    // Порядок справочника — это порядок в воронке настроек, в отчёте он ничего
    // не значит: «Район не подходит» (386) стояло под «Не отвечает» (227).
    .sort((a, b) => b.count - a.count);
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
            <div className={styles.frow} key={stage.id}>
              <span className={styles.fname}>
                <StageIndicator
                  stage={{
                    id: stage.id,
                    kind: (stage.kind ?? "open") as "open" | "won" | "lost",
                    position: stage.position ?? 0,
                  }}
                  stages={openStages.map((item) => ({
                    id: item.id,
                    kind: (item.kind ?? "open") as "open" | "won" | "lost",
                    position: item.position ?? 0,
                  }))}
                  name={stage.name}
                />
              </span>
              <div className={styles.trackWrap}>
                <StageIndicator
                  stage={{
                    id: stage.id,
                    kind: (stage.kind ?? "open") as "open" | "won" | "lost",
                    position: stage.position ?? 0,
                  }}
                  stages={openStages.map((item) => ({
                    id: item.id,
                    kind: (item.kind ?? "open") as "open" | "won" | "lost",
                    position: item.position ?? 0,
                  }))}
                  name={stage.name}
                  variant="track"
                  fillRatio={stage.count / maxStageCount}
                />
                <span className={`${styles.num} num`}>{stage.count}</span>
              </div>
              <span className={`${styles.conv} num`}>
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
            {usingChannels
              ? "По меткам канала: справочник источников в Amo не заполнялся"
              : "Все сделки, включая исторические значения справочника"}
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
