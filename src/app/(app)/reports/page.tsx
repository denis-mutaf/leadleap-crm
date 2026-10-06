import Link from "next/link";
import { Info } from "lucide-react";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { BuilderDashboard } from "./builder-dashboard";
import { loadBuilderDashboard } from "./builder-data";
import {
  type ReportSearchParams,
  type ReportParams,
  loadPeriodReport,
  parseReportParams,
  reportQuery,
} from "./reports-data";
import { ReportsToolbar } from "./reports-toolbar";
import {
  Cohorts,
  Funnel,
  Insight,
  ManagersTable,
  Matrix,
  ProjectsTable,
  Reasons,
  SourcesTable,
  Widgets,
  funnelInsight,
  sourceInsight,
} from "./reports-view";
import { SnapshotView } from "./snapshot-view";

type Period = "month" | "quarter" | "year";
type ReportsSearchParams = Promise<ReportSearchParams>;

function parsePeriod(value: string | string[] | undefined): Period {
  const period = Array.isArray(value) ? value[0] : value;
  return period === "quarter" || period === "year" ? period : "month";
}

function Tabs({ params }: { params: ReportParams }) {
  const tabs = [
    ["period", "За период"],
    ["snapshot", "Сейчас в воронке"],
  ] as const;
  return (
    <nav className="view-switch" aria-label="Вид отчёта">
      {tabs.map(([tab, label]) => (
        <Link
          key={tab}
          href={`/reports${reportQuery(params, { tab })}`}
          aria-current={params.tab === tab ? "page" : undefined}
        >
          <span className={params.tab === tab ? "view-switch-active" : undefined}>{label}</span>
        </Link>
      ))}
    </nav>
  );
}

async function PeriodView({ params }: { params: ReportParams }) {
  let data;
  try {
    data = await loadPeriodReport(params);
  } catch {
    return (
      <section className="reports-access">
        <Info size={20} />
        <div>
          <strong>Отчёт временно недоступен</strong>
          <p>Не удалось посчитать отчёт за период. Проверьте соединение и повторите попытку.</p>
          <a href={`/reports${reportQuery(params)}`}>Повторить</a>
        </div>
      </section>
    );
  }
  const { report, cohorts } = data;
  const funnelNote = funnelInsight(report.stages, report.widgets);
  const sourceNote = sourceInsight(report.sources);
  return (
    <>
      <ReportsToolbar
        params={params}
        sources={data.sources}
        projects={data.projects}
        managers={data.managers}
        updatedAt={report.generated_at}
      />
      <Widgets widgets={report.widgets} />
      <Funnel stages={report.stages} />
      {funnelNote ? <Insight>{funnelNote}</Insight> : null}
      <Matrix stages={report.stages} />
      <SourcesTable rows={report.sources} />
      {sourceNote ? <Insight>{sourceNote}</Insight> : null}
      <ProjectsTable rows={report.projects} />
      <ManagersTable rows={report.managers} />
      <Cohorts rows={cohorts} />
      <Reasons rows={report.reasons} />
    </>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams?: ReportsSearchParams;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role === "manager") redirect("/deals");
  const search = searchParams ? await searchParams : undefined;
  if (profile.role === "builder") {
    const data = await loadBuilderDashboard(parsePeriod(search?.period));
    return (
      <BuilderDashboard
        data={{
          ...data,
          exportHref: `/api/reports/builder-export?period=${data.period}`,
        }}
      />
    );
  }

  const params = parseReportParams(search);
  return (
    <div className="reports-page">
      <header className="reports-header">
        <div>
          <p className="reports-eyebrow">Сводка отдела</p>
          <h1>Отчёты</h1>
        </div>
        <Tabs params={params} />
      </header>
      {params.tab === "snapshot" ? <SnapshotView /> : <PeriodView params={params} />}
    </div>
  );
}
