import Link from "next/link";
import { Download } from "lucide-react";
import { DateField } from "@/components/crm/date-field";
import { AutoSubmitForm } from "../auto-submit-form";
import {
  NO_MANAGER,
  type Option,
  type PeriodKind,
  type ReportParams,
  periodLabel,
  reportQuery,
} from "./reports-data";
import styles from "./reports.module.css";

const PERIODS: [PeriodKind, string][] = [
  ["week", "Неделя"],
  ["month", "Месяц"],
  ["quarter", "Квартал"],
  ["custom", "Свой"],
];

type Props = {
  params: ReportParams;
  sources: Option[];
  projects: Option[];
  managers: Option[];
  updatedAt: string;
};

const updatedFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Chisinau",
});

function FilterSelect({
  name,
  label,
  value,
  options,
  noneLabel,
}: {
  name: string;
  label: string;
  value: string | null;
  options: Option[];
  noneLabel: string;
}) {
  return (
    <label className={styles.filter}>
      <span className="toolbar-label">{label}</span>
      <select name={name} defaultValue={value ?? ""} aria-label={label}>
        <option value="">Все</option>
        <option value="none">{noneLabel}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ReportsToolbar({
  params,
  sources,
  projects,
  managers,
  updatedAt,
}: Props) {
  const exportHref = `/api/reports/export${reportQuery(params)}`;
  return (
    <>
      <div className={styles.toolbar}>
        <nav className={styles.segment} aria-label="Период">
          {PERIODS.map(([kind, label]) => (
            <Link
              key={kind}
              href={`/reports${reportQuery(params, { period: kind })}`}
              className={`${styles.segmentItem} ${params.period === kind ? styles.segmentActive : ""}`}
              aria-current={params.period === kind ? "page" : undefined}
              scroll={false}
            >
              {label}
            </Link>
          ))}
        </nav>
        <span className={styles.quiet}>{periodLabel(params.from, params.to)}</span>
        <a className="btn btn-ghost" href={exportHref} download>
          <Download size={14} />
          Экспорт
        </a>
      </div>
      <AutoSubmitForm action="/reports" className={styles.filters}>
        <input type="hidden" name="period" value={params.period} />
        {params.period === "custom" ? (
          <>
            <label className={styles.filter}>
              <span className="toolbar-label">С</span>
              <DateField name="from" defaultValue={params.from} autoSubmit aria-label="Начало периода" />
            </label>
            <label className={styles.filter}>
              <span className="toolbar-label">По</span>
              <DateField name="to" defaultValue={params.to} autoSubmit aria-label="Конец периода" />
            </label>
          </>
        ) : null}
        <FilterSelect
          name="project"
          label="Проект"
          value={params.project}
          options={projects}
          noneLabel="Не указан"
        />
        <FilterSelect
          name="manager"
          label="Менеджер"
          value={params.manager}
          options={managers}
          noneLabel={NO_MANAGER}
        />
        <FilterSelect
          name="source"
          label="Источник"
          value={params.source}
          options={sources}
          noneLabel="Не указан"
        />
        <span className={`${styles.quiet} ${styles.updated}`}>
          Обновлено {updatedFormatter.format(new Date(updatedAt))}
        </span>
      </AutoSubmitForm>
    </>
  );
}
