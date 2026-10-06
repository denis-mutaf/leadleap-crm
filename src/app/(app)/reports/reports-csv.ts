import {
  type PeriodReportData,
  type ReportParams,
  firstResponse,
  managerLabel,
  monthLabel,
  percent,
  periodLabel,
  projectLabel,
  sourceLabel,
} from "./reports-data";

type Cell = string | number | null;

function csvCell(value: Cell) {
  const text = value == null ? "" : String(value);
  const safeText = /^[\t \r\n]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

const csvRow = (values: Cell[]) => values.map(csvCell).join(",");

const pct = (value: number, total: number) => {
  const result = percent(value, total);
  return result == null ? null : Math.round(result * 10) / 10;
};

// CSV текущего отчёта: источники, проекты, менеджеры, когорты. Фильтры периода и разрезов
// уже применены в БД; шапка файла называет период, чтобы выгрузку можно было узнать потом.
export function buildReportCsv(params: ReportParams, data: PeriodReportData) {
  const { report, cohorts } = data;
  const name = (list: { id: string; name: string }[], id: string | null, none: string) =>
    id == null ? "все" : id === "none" ? none : (list.find((x) => x.id === id)?.name ?? id);
  const lines: string[] = [
    csvRow(["Отчёт за период", periodLabel(params.from, params.to), `${params.from} — ${params.to}`]),
    csvRow([
      "Фильтры",
      `Источник: ${name(data.sources, params.source, "не указан")}`,
      `Проект: ${name(data.projects, params.project, "не указан")}`,
      `Менеджер: ${name(data.managers, params.manager, "без менеджера")}`,
    ]),
    csvRow(["Часовой пояс", "Europe/Chisinau"]),
    "",
  ];
  const segmentHead = [
    "Обращений",
    "Дозвонились",
    "Дозвон, % от обращений",
    "Встреч проведено",
    "Резерваций",
    "Дошли до резервации из обращений периода",
    "Конверсия в резервацию, %",
  ];
  const segment = (row: (typeof report.sources)[number], label: string): Cell[] => [
    label,
    row.obr,
    row.answered,
    pct(row.answered, row.obr),
    row.met,
    row.resv,
    row.conv,
    pct(row.conv, row.obr),
  ];

  lines.push(csvRow(["Источники"]), csvRow(["Источник", ...segmentHead]));
  for (const row of report.sources) lines.push(csvRow(segment(row, sourceLabel(row))));
  lines.push("", csvRow(["Проекты"]), csvRow(["Проект", ...segmentHead]));
  for (const row of report.projects) lines.push(csvRow(segment(row, projectLabel(row))));

  lines.push(
    "",
    csvRow(["Менеджеры"]),
    csvRow([
      "Менеджер",
      "Обращений",
      "Первый ответ, медиана, мин",
      "Сделок с найденным первым действием",
      "Встреч проведено",
      "Резерваций",
      "Просрочено задач сейчас",
      "Открытых сделок без следующего шага сейчас",
    ]),
  );
  for (const row of report.managers) {
    const response = firstResponse(row);
    lines.push(
      csvRow([
        managerLabel(row),
        row.obr,
        response.value == null ? null : Math.round(response.value),
        row.measured,
        row.met,
        row.resv,
        row.overdue,
        row.no_next,
      ]),
    );
  }

  lines.push(
    "",
    csvRow(["Когорты: доля лидов месяца создания, дошедших до «Резервации» и дальше"]),
    csvRow([
      "Месяц создания",
      "Лидов",
      "За 3 мес.",
      "За 3 мес., %",
      "За 6 мес.",
      "За 6 мес., %",
      "За 12 мес.",
      "За 12 мес., %",
      "Из них учтено только текущим этапом (нет истории переходов)",
    ]),
  );
  for (const row of cohorts) {
    const cells = ([row.r3, row.r6, row.r12] as (number | null)[]).flatMap((value) => [
      value,
      value == null ? null : pct(value, row.n),
    ]);
    lines.push(csvRow([monthLabel(row.month), row.n, ...cells, row.fallback]));
  }
  lines.push(
    "",
    csvRow([
      "История переходов ведётся с 20.05.2026: более ранние сделки из Amo попадают в отчёт только текущим этапом",
    ]),
  );
  // BOM — чтобы Excel открыл кириллицу как UTF-8.
  return `﻿${lines.join("\r\n")}\r\n`;
}
