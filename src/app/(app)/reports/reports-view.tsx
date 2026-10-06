import {
  CalendarCheck,
  CircleAlert,
  Handshake,
  Inbox,
  Minus,
  Phone,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import type { CSSProperties } from "react";
import { StageIndicator } from "@/components/crm/stage-indicator";
import {
  type CohortRow,
  type ManagerRow,
  type PeriodReport,
  type SegmentRow,
  type StageRow,
  firstResponse,
  formatDuration,
  managerLabel,
  monthLabel,
  percent,
  projectLabel,
  sourceLabel,
} from "./reports-data";
import styles from "./reports.module.css";

const nf = new Intl.NumberFormat("ru-RU");
const pf = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const pct = (value: number | null) => (value == null ? "—" : `${pf.format(value)} %`);
const share = (value: number, total: number) => pct(percent(value, total));
const euro = (value: number) => `€ ${nf.format(Math.round(value))}`;
const order = (index: number) => ({ "--i": Math.min(index, 12) }) as CSSProperties;

const HISTORY_NOTE =
  "История переходов ведётся с 20.05.2026: более ранние сделки из Amo попадают в отчёт только текущим этапом";

// ---------- виджеты ----------

type Delta = { text: string; tone: "up" | "down" | "flat" };

function relativeDelta(cur: number, prev: number): Delta {
  if (cur === prev) return { text: "без изменений", tone: "flat" };
  if (prev === 0) return { text: `+${nf.format(cur)}`, tone: "up" };
  const change = ((cur - prev) / prev) * 100;
  return {
    text: `${change > 0 ? "" : "−"}${pf.format(Math.abs(change)).replace(",0", "")} %`,
    tone: change > 0 ? "up" : "down",
  };
}

function Trend({ delta, hint }: { delta: Delta; hint: string }) {
  const Icon = delta.tone === "up" ? TrendingUp : delta.tone === "down" ? TrendingDown : Minus;
  return (
    <small className={`${styles.delta} ${styles[`delta_${delta.tone}`]}`} title={hint}>
      <Icon size={13} /> {delta.text}
    </small>
  );
}

export function Widgets({ widgets }: { widgets: PeriodReport["widgets"] }) {
  const { answered, reservations } = widgets;
  const answeredCur = percent(answered.cur, answered.of_cur);
  const answeredPrev = percent(answered.prev, answered.of_prev);
  const answeredDiff =
    answeredCur == null || answeredPrev == null ? null : answeredCur - answeredPrev;
  const answeredDelta: Delta =
    answeredDiff == null || Math.abs(answeredDiff) < 0.5
      ? { text: "без изменений", tone: "flat" }
      : {
          text: `${answeredDiff > 0 ? "+" : "−"}${Math.round(Math.abs(answeredDiff))} п. п.`,
          tone: answeredDiff > 0 ? "up" : "down",
        };
  const reservationDiff = reservations.cur - reservations.prev;
  const reservationDelta: Delta =
    reservationDiff === 0
      ? { text: "без изменений", tone: "flat" }
      : {
          text: `${reservationDiff > 0 ? "+" : "−"}${Math.abs(reservationDiff)}`,
          tone: reservationDiff > 0 ? "up" : "down",
        };
  const partialAmount = reservations.cur > 0 && reservations.known_cur < reservations.cur;
  const tiles = [
    {
      icon: Inbox,
      label: "Новых обращений",
      value: nf.format(widgets.new.cur),
      delta: relativeDelta(widgets.new.cur, widgets.new.prev),
      hint: `Прошлый период: ${nf.format(widgets.new.prev)}`,
    },
    {
      icon: Phone,
      label: "Дозвонились",
      value: pct(answeredCur),
      delta: answeredDelta,
      hint: `${nf.format(answered.cur)} из ${nf.format(answered.of_cur)} новых обращений; прошлый период: ${nf.format(answered.prev)} из ${nf.format(answered.of_prev)}`,
    },
    {
      icon: CalendarCheck,
      label: "Встреч проведено",
      value: nf.format(widgets.meetings.cur),
      delta: relativeDelta(widgets.meetings.cur, widgets.meetings.prev),
      hint: `Прошлый период: ${nf.format(widgets.meetings.prev)}`,
    },
    {
      icon: Handshake,
      label: "Резерваций",
      value:
        reservations.cur > 0 && reservations.known_cur > 0
          ? `${nf.format(reservations.cur)} · ${euro(reservations.sum_cur)}`
          : nf.format(reservations.cur),
      delta: reservationDelta,
      hint: `Прошлый период: ${nf.format(reservations.prev)}${reservations.prev > 0 ? ` · ${euro(reservations.sum_prev)}` : ""}${partialAmount ? `. Сумма известна у ${reservations.known_cur} из ${reservations.cur}` : ""}`,
    },
  ];
  return (
    <section className="report-metrics motion-list" aria-label="Итоги периода">
      {tiles.map(({ icon: Icon, label, value, delta, hint }, index) => (
        <article className="report-metric" key={label} style={order(index)}>
          <span>
            <Icon size={14} className={styles.metricIcon} /> {label}
          </span>
          <strong className="num-dots">{value}</strong>
          <Trend delta={delta} hint={`К прошлому периоду. ${hint}`} />
        </article>
      ))}
    </section>
  );
}

// ---------- воронка и конверсия ----------

export function Funnel({ stages }: { stages: StageRow[] }) {
  const max = Math.max(1, ...stages.map((stage) => stage.entered));
  const ref = stages.map((stage) => ({ id: stage.id, kind: stage.kind, position: stage.position }));
  const total = stages.reduce((sum, stage) => sum + stage.entered, 0);
  return (
    <section className="report-section">
      <h2>Движение по воронке</h2>
      <p className="section-subtitle">
        Сколько сделок вошло в этап за период · из журнала переходов, не из остатков
      </p>
      <div className="motion-list">
        {stages.map((stage, index) => (
          <div className={`${styles.frow} ${styles.frowTwo}`} key={stage.id} style={order(index)}>
            <span className={styles.fname}>
              <StageIndicator stage={ref[index]} stages={ref} name={stage.name} />
            </span>
            <div className={styles.trackWrap}>
              <StageIndicator
                stage={ref[index]}
                stages={ref}
                name={stage.name}
                variant="track"
                fillRatio={stage.entered / max}
              />
              <span className={`${styles.num} num`}>{nf.format(stage.entered)}</span>
            </div>
          </div>
        ))}
      </div>
      {total === 0 ? <p className="empty-report">За период нет ни одного перехода.</p> : null}
      <p className={styles.quiet}>{HISTORY_NOTE}</p>
    </section>
  );
}

export function Matrix({ stages }: { stages: StageRow[] }) {
  const ref = stages.map((stage) => ({ id: stage.id, kind: stage.kind, position: stage.position }));
  const mark = (stage: StageRow, index: number) => (stage.kind === "won" ? "Д" : String(index + 1));
  return (
    <section className="report-section">
      <h2>Конверсия по этапам</h2>
      <p className="section-subtitle">
        Из сделок, вошедших в этап слева, доля тех, что позже в этом же периоде вошли в этап из
        колонки. Цифры колонок — номера этапов слева; «Д» — договор
      </p>
      <div className={styles.tableTile}>
        <div className={styles.scroll}>
          <table className={`${styles.table} ${styles.matrix}`}>
            <thead>
              <tr>
                <th>Вошли в этап</th>
                <th className={styles.right}>Сделок</th>
                {stages.map((stage, index) => (
                  <th className={styles.right} key={stage.id} title={stage.name}>
                    {mark(stage, index)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stages.map((row, rowIndex) => (
                <tr key={row.id}>
                  <td>
                    <span className={styles.stageCell}>
                      <span className={styles.stageNo}>{mark(row, rowIndex)}</span>
                      <StageIndicator stage={ref[rowIndex]} stages={ref} name={row.name} />
                    </span>
                  </td>
                  <td className={`${styles.right} ${styles.nums}`}>{nf.format(row.entered)}</td>
                  {stages.map((col, colIndex) => {
                    if (colIndex <= rowIndex) {
                      return <td key={col.id} className={styles.matrixEmpty} />;
                    }
                    if (row.entered === 0) {
                      return (
                        <td key={col.id} className={`${styles.right} ${styles.nums} ${styles.muted}`}>
                          —
                        </td>
                      );
                    }
                    const count = row.reached[col.id] ?? 0;
                    return (
                      <td
                        key={col.id}
                        className={`${styles.right} ${styles.nums} ${count === 0 ? styles.muted : ""}`}
                        title={`${nf.format(count)} из ${nf.format(row.entered)}: ${row.name} → ${col.name}`}
                      >
                        {count === 0 ? "0" : share(count, row.entered)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

// ---------- вывод словами ----------

export function Insight({ children }: { children: React.ReactNode }) {
  return (
    <div className="reports-note">
      <CircleAlert size={16} className={styles.warn} /> {children}
    </div>
  );
}

export function funnelInsight(stages: StageRow[], widgets: PeriodReport["widgets"]) {
  const first = stages.find((stage) => stage.kind === "open");
  if (!first || first.entered === 0) return null;
  const meetings = widgets.meetings.cur;
  const reservations = widgets.reservations.cur;
  return `За период в воронку вошло ${nf.format(first.entered)} сделок, встреч проведено ${nf.format(meetings)}, резерваций ${nf.format(reservations)}.`;
}

export function sourceInsight(rows: SegmentRow[]) {
  const withResv = rows.filter((row) => row.resv > 0).sort((a, b) => b.resv - a.resv);
  const totalResv = rows.reduce((sum, row) => sum + row.resv, 0);
  if (totalResv === 0) return null;
  const top = withResv[0];
  return `Больше всего резерваций за период — «${sourceLabel(top)}»: ${nf.format(top.resv)} из ${nf.format(totalResv)}.`;
}

// ---------- таблицы разрезов ----------

function SegmentTable({
  title,
  subtitle,
  firstColumn,
  rows,
  label,
}: {
  title: string;
  subtitle: string;
  firstColumn: string;
  rows: SegmentRow[];
  label: (row: SegmentRow) => string;
}) {
  return (
    <section className="report-section">
      <h2>{title}</h2>
      <p className="section-subtitle">{subtitle}</p>
      {rows.length === 0 ? (
        <p className="empty-report">За период нет обращений и событий воронки.</p>
      ) : (
        <div className={styles.tableTile}>
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{firstColumn}</th>
                  <th className={styles.right} title="Сделки, созданные за период">
                    Обращений
                  </th>
                  <th
                    className={styles.right}
                    title="Доля обращений периода, у контакта которых есть отвеченный звонок (разговор дольше 0 секунд) за период"
                  >
                    Дозвон
                  </th>
                  <th className={styles.right} title="Сделки, вошедшие в этап «Встреча проведена» за период">
                    Встречи
                  </th>
                  <th className={styles.right} title="Сделки, вошедшие в этап «Резервация» за период">
                    Резервации
                  </th>
                  <th
                    className={styles.right}
                    title="Из обращений периода — доля тех, что дошли до «Резервации» в этом же периоде"
                  >
                    Конверсия в резервацию
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <td className={row.key === "none" ? styles.muted : undefined}>{label(row)}</td>
                    <td className={`${styles.right} ${styles.nums}`}>{nf.format(row.obr)}</td>
                    <td
                      className={`${styles.right} ${styles.nums}`}
                      title={row.obr ? `${nf.format(row.answered)} из ${nf.format(row.obr)}` : undefined}
                    >
                      {share(row.answered, row.obr)}
                    </td>
                    <td className={`${styles.right} ${styles.nums}`}>{nf.format(row.met)}</td>
                    <td className={`${styles.right} ${styles.nums}`}>{nf.format(row.resv)}</td>
                    <td
                      className={`${styles.right} ${styles.nums}`}
                      title={row.obr ? `${nf.format(row.conv)} из ${nf.format(row.obr)}` : undefined}
                    >
                      {share(row.conv, row.obr)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

export function SourcesTable({ rows }: { rows: SegmentRow[] }) {
  return (
    <SegmentTable
      title="Откуда приходят"
      subtitle="По источнику сделки. Расходов на рекламу в CRM нет, поэтому стоимости обращения здесь нет"
      firstColumn="Источник"
      rows={rows}
      label={sourceLabel}
    />
  );
}

export function ProjectsTable({ rows }: { rows: SegmentRow[] }) {
  return (
    <SegmentTable
      title="По проектам"
      subtitle="Проект заполнен у малой части сделок, остальные — в строке «Проект: не указан». Сделка с двумя проектами учтена в обоих"
      firstColumn="Проект"
      rows={rows}
      label={projectLabel}
    />
  );
}

function ManagerRowView({ row }: { row: ManagerRow }) {
  const response = firstResponse(row);
  return (
    <tr>
      <td className={row.key === "none" ? styles.muted : undefined}>{managerLabel(row)}</td>
      <td className={`${styles.right} ${styles.nums}`}>{nf.format(row.obr)}</td>
      <td
        className={`${styles.right} ${styles.nums} ${response.value == null ? styles.muted : ""}`}
        title={
          response.value == null
            ? (response.note ?? undefined)
            : `Медиана по ${nf.format(row.measured)} из ${nf.format(row.obr)} сделок: от создания до первого исходящего звонка, сообщения или выполненной задачи`
        }
      >
        {response.value == null ? "—" : formatDuration(response.value)}
      </td>
      <td className={`${styles.right} ${styles.nums}`}>{nf.format(row.met)}</td>
      <td className={`${styles.right} ${styles.nums}`}>{nf.format(row.resv)}</td>
      <td className={`${styles.right} ${styles.nums}`}>{nf.format(row.overdue)}</td>
      <td className={`${styles.right} ${styles.nums}`}>{nf.format(row.no_next)}</td>
    </tr>
  );
}

export function ManagersTable({ rows }: { rows: ManagerRow[] }) {
  return (
    <section className="report-section">
      <h2>Работа менеджеров</h2>
      <p className="section-subtitle">
        Сделки закреплены за текущим ответственным. «Просрочено» и «Без следующего шага» — состояние
        на сейчас, а не за период
      </p>
      {rows.length === 0 ? (
        <p className="empty-report">Нет данных по менеджерам.</p>
      ) : (
        <div className={styles.tableTile}>
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Менеджер</th>
                  <th className={styles.right} title="Сделки, созданные за период">
                    Обращений
                  </th>
                  <th
                    className={styles.right}
                    title="Медиана от создания сделки до первого исходящего звонка, сообщения или выполненной задачи. Если первое действие найдено меньше чем у половины сделок — «—»"
                  >
                    Первый ответ
                  </th>
                  <th className={styles.right} title="Сделки, вошедшие в этап «Встреча проведена» за период">
                    Встреч
                  </th>
                  <th className={styles.right} title="Сделки, вошедшие в этап «Резервация» за период">
                    Резерваций
                  </th>
                  <th className={styles.right} title="Открытые задачи по сделкам со сроком в прошлом, на сейчас">
                    Просрочено задач
                  </th>
                  <th className={styles.right} title="Открытые сделки без единой открытой задачи, на сейчас">
                    Без следующего шага
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <ManagerRowView key={row.key} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------- когорты ----------

function CohortCell({ value, total }: { value: number | null; total: number }) {
  if (value == null) return <td className={styles.right} />;
  return (
    <td className={`${styles.right} ${styles.nums}`} title={`${nf.format(value)} из ${nf.format(total)}`}>
      {share(value, total)}
    </td>
  );
}

export function Cohorts({ rows }: { rows: CohortRow[] | null }) {
  if (rows === null) {
    return (
      <section className="report-section">
        <h2>Когорты</h2>
        <p className="section-subtitle">
          Лиды по месяцу создания и доля тех, что дошли до «Резервации» или дальше за 3, 6 и 12 месяцев
        </p>
        <div className="reports-note" role="alert">
          <CircleAlert size={16} className={styles.warn} /> Не удалось посчитать когорты. Остальной
          отчёт показан полностью — обновите страницу, чтобы повторить.
        </div>
      </section>
    );
  }
  const fallbackTotal = rows.reduce((sum, row) => sum + row.fallback, 0);
  return (
    <section className="report-section">
      <h2>Когорты</h2>
      <p className="section-subtitle">
        Лиды по месяцу создания и доля тех, что дошли до «Резервации» или дальше за 3, 6 и 12 месяцев.
        Пустая ячейка — срок ещё не прошёл. Фильтр периода не действует, разрезы — действуют
      </p>
      {rows.length === 0 ? (
        <p className="empty-report">Нет сделок для когорт.</p>
      ) : (
        <div className={styles.tableTile}>
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Месяц создания</th>
                  <th className={styles.right}>Лидов</th>
                  <th className={styles.right}>За 3 месяца</th>
                  <th className={styles.right}>За 6 месяцев</th>
                  <th className={styles.right}>За 12 месяцев</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.month}>
                    <td className={styles.capitalize}>
                      {monthLabel(row.month)}
                      {row.fallback > 0 ? (
                        <span
                          className={styles.asterisk}
                          title={`${nf.format(row.fallback)} сделок учтены только текущим этапом: истории переходов у них нет`}
                        >
                          *
                        </span>
                      ) : null}
                    </td>
                    <td className={`${styles.right} ${styles.nums}`}>{nf.format(row.n)}</td>
                    <CohortCell value={row.r3} total={row.n} />
                    <CohortCell value={row.r6} total={row.n} />
                    <CohortCell value={row.r12} total={row.n} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {fallbackTotal > 0 ? (
        <p className={styles.quiet}>
          * Сделка без записанных переходов в «Резервацию» и дальше считается дошедшей, если сейчас
          стоит на этом этапе или позже, — во всех созревших ячейках: дату перехода восстановить
          нельзя.
        </p>
      ) : null}
      <p className={styles.quiet}>{HISTORY_NOTE}</p>
    </section>
  );
}

// ---------- причины отказа ----------

export function Reasons({ rows }: { rows: PeriodReport["reasons"] }) {
  const total = rows.reduce((sum, row) => sum + row.n, 0);
  const max = Math.max(1, ...rows.map((row) => row.n));
  return (
    <section className="report-section">
      <h2>Почему отказывают</h2>
      <p className="section-subtitle">
        Сделки, закрытые отказом за период (по дате закрытия): {nf.format(total)}
      </p>
      {rows.length === 0 ? (
        <p className="empty-report">За период нет закрытых отказом сделок.</p>
      ) : (
        <div className="motion-list">
          {rows.map((row, index) => (
            <div className={styles.reasonRow} key={row.key} style={order(index)}>
              <span className={row.key === "none" ? styles.muted : undefined}>
                {row.key === "none" ? "Причина не указана" : (row.name ?? "Причина удалена")}
              </span>
              <div className={styles.reasonTrack}>
                <i style={{ transform: `scaleX(${row.n / max})` }} />
                <span className={`${styles.num} num`}>{nf.format(row.n)}</span>
              </div>
              <span className={styles.conv}>{share(row.n, total)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
