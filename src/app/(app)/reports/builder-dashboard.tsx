import {
  Banknote,
  CircleAlert,
  Download,
  FileText,
  Handshake,
  LayoutDashboard,
  Shield,
  Timer,
} from "lucide-react";
import styles from "./builder-dashboard.module.css";

export type Amount = { sum: number; knownCount: number; totalCount: number };
export type BuilderDashboardData = {
  period: "month" | "quarter" | "year";
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
  exportHref?: string;
};

const nf = new Intl.NumberFormat("ru-RU");
const dateTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Chisinau",
});
const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/Chisinau",
});
const amount = (value: number | null, currency = "€") =>
  value == null ? "—" : `${currency} ${nf.format(value)}`;
function formatDate(value: string, formatter: Intl.DateTimeFormat) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : formatter.format(parsed);
}
function amountLabel(value: Amount) {
  if (!value.knownCount) return "—";
  return value.knownCount < value.totalCount
    ? `${amount(value.sum)} (${nf.format(value.knownCount)}/${nf.format(value.totalCount)})`
    : amount(value.sum);
}
function partialLabel(value: Amount) {
  return value.knownCount < value.totalCount
    ? `из ${nf.format(value.totalCount)} записей известны суммы для ${nf.format(value.knownCount)}`
    : null;
}
function Icon({ children }: { children: React.ReactNode }) {
  return (
    <span className={styles.mutedIcon} aria-hidden="true">
      {children}
    </span>
  );
}

export function BuilderDashboard({ data }: { data: BuilderDashboardData }) {
  const maxStage = Math.max(1, ...data.stageBars.map((stage) => stage.count));
  const reservationPartial = partialLabel(data.metrics.reservationAmount);
  const contractPartial = partialLabel(data.metrics.contractAmount);
  const periods = [
    ["month", "Месяц"],
    ["quarter", "Квартал"],
    ["year", "Год"],
  ] as const;
  return (
    <div className={styles.dashboard}>
      <header className={styles.header}>
        <LayoutDashboard size={16} className={styles.headerIcon} />
        <span>Дашборд</span>
        <span className={styles.spacer} />
        <span className={styles.avatar} aria-label="ISRAGRUP">
          ИС
        </span>
      </header>
      <div className={styles.toolbar}>
        <nav className={styles.periods} aria-label="Период">
          {periods.map(([value, label]) => (
            <a
              className={`${styles.period} ${data.period === value ? styles.periodActive : ""}`}
              href={`/reports?period=${value}`}
              aria-current={data.period === value ? "page" : undefined}
              key={value}
            >
              {label}
            </a>
          ))}
        </nav>
        <span className={styles.quiet}>
          {data.periodLabel} · {formatDate(data.asOf, dateTimeFormatter)}
        </span>
        <span className={styles.spacer} />
        {data.exportHref ? (
          <a className={styles.export} href={data.exportHref} download>
            <Download size={14} />
            Экспорт
          </a>
        ) : null}
      </div>
      <div className={styles.content}>
        <section aria-label="Ключевые числа">
          <div className={styles.metrics}>
            <article className={styles.metric}>
              <span className={styles.metricLabel}>
                <Icon>
                  <Handshake size={14} />
                </Icon>
                Резерваций
              </span>
              <strong className={styles.metricValue}>
                {nf.format(data.metrics.reservations)}
              </strong>
            </article>
            <article className={styles.metric}>
              <span className={styles.metricLabel}>
                <Icon>
                  <Banknote size={14} />
                </Icon>
                Сумма резерваций
              </span>
              <strong className={styles.metricValue}>
                {amountLabel(data.metrics.reservationAmount)}
              </strong>
              {reservationPartial && (
                <span className={styles.partial}>{reservationPartial}</span>
              )}
            </article>
            <article className={styles.metric}>
              <span className={styles.metricLabel}>
                <Icon>
                  <FileText size={14} />
                </Icon>
                Договоров
              </span>
              <strong className={styles.metricValue}>
                {nf.format(data.metrics.contracts)} ·{" "}
                {amountLabel(data.metrics.contractAmount)}
              </strong>
              {contractPartial && (
                <span className={styles.partial}>{contractPartial}</span>
              )}
            </article>
            <article className={styles.metric}>
              <span className={styles.metricLabel}>
                <Icon>
                  <Timer size={14} />
                </Icon>
                От обращения до резервации
              </span>
              <strong className={styles.metricValue}>
                {data.metrics.daysToReservation == null
                  ? "—"
                  : `${nf.format(data.metrics.daysToReservation)} дн.`}
              </strong>
            </article>
          </div>
        </section>
        <section aria-labelledby="projects-title">
          <h2 id="projects-title" className={styles.sectionTitle}>
            Площадки
          </h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Площадка</th>
                  <th className={styles.right}>Обращений</th>
                  <th className={styles.right}>Встреч</th>
                  <th className={styles.right}>Резерваций</th>
                  <th className={styles.right}>Сумма резерваций</th>
                  <th className={styles.right}>Договоров</th>
                  <th className={styles.right}>Сумма договоров</th>
                </tr>
              </thead>
              <tbody>
                {data.projects.length ? (
                  data.projects.map((row) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td className={styles.right}>
                        {nf.format(row.inquiries)}
                      </td>
                      <td className={styles.right}>
                        {nf.format(row.meetings)}
                      </td>
                      <td className={styles.right}>
                        {nf.format(row.reservations)}
                      </td>
                      <td className={styles.right}>
                        {amountLabel(row.reservationAmount)}
                      </td>
                      <td className={styles.right}>
                        {nf.format(row.contracts)}
                      </td>
                      <td className={styles.right}>
                        {amountLabel(row.contractAmount)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className={styles.empty} colSpan={7}>
                      Нет данных по площадкам за выбранный период
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className={styles.tableNote}>
            Суммы в формате «известно/всего» рассчитаны только по записям с
            указанной суммой.
          </p>
        </section>
        <section aria-labelledby="funnel-title">
          <h2 id="funnel-title" className={styles.sectionTitle}>
            Где сейчас покупатели
          </h2>
          {data.stageBars.length ? (
            data.stageBars.map((stage) => (
              <div className={styles.barRow} key={stage.name}>
                <span className={styles.barName}>{stage.name}</span>
                <div
                  className={styles.barTrack}
                  style={{
                    width: `${Math.max((stage.count / maxStage) * 100, stage.count ? 3 : 0)}%`,
                    minWidth: stage.count ? "34px" : 0,
                  }}
                >
                  <span className={styles.barNumber}>
                    {nf.format(stage.count)}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className={styles.empty}>Нет данных по этапам</div>
          )}
        </section>
        {data.openTotal > 0 && data.stageBars.length > 0 ? (
          <div className={styles.insight}>
            <CircleAlert size={16} />
            <p>
              На открытых этапах находится{" "}
              {nf.format(
                data.stageBars.reduce((sum, stage) => sum + stage.count, 0),
              )}{" "}
              из {nf.format(data.openTotal)} сделок.
            </p>
          </div>
        ) : null}
        <section aria-labelledby="reservations-title">
          <h2 id="reservations-title" className={styles.sectionTitle}>
            Резервации за период
          </h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Объект</th>
                  <th>Площадка</th>
                  <th className={styles.right}>Сумма</th>
                  <th className={styles.right}>Дата</th>
                </tr>
              </thead>
              <tbody>
                {data.reservationRows.length ? (
                  data.reservationRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.object}</td>
                      <td>
                        <span className={styles.tag}>{row.project}</span>
                      </td>
                      <td className={styles.right}>
                        {amount(row.amount, row.currency)}
                      </td>
                      <td className={styles.right}>
                        {formatDate(row.date, dateFormatter)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className={styles.empty} colSpan={4}>
                      Нет резерваций за выбранный период
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        <div className={styles.notice}>
          <Shield size={16} />
          <p>
            {data.dataNote?.length
              ? data.dataNote.join(" ")
              : "Имена и контакты покупателей в этом разделе не показываются. Доступ к ним есть у отдела продаж."}
          </p>
        </div>
      </div>
    </div>
  );
}
