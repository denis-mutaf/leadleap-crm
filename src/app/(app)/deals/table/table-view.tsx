"use client";

import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  X,
} from "lucide-react";
import Link from "next/link";
import Form from "next/form";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { StageIndicator } from "@/components/crm/stage-indicator";
import { stageHueVars, type StageHue } from "@/lib/stage-colors";
import { createClient } from "@/lib/supabase/client";
import styles from "./table.module.css";
import { startRouteProgress } from "../../route-progress";

export type TableDeal = {
  id: string;
  contact: string;
  stage: string;
  stageKind: string;
  stageHue: StageHue;
  tags: string[];
  task: string;
  taskDueAt: string | null;
  activity: string;
  activityAt: string | null;
  created: string;
  owner: string;
  ownerId?: string | null;
  stageId?: string;
};

type Option = { id: string; name: string };
type Props = {
  rows: TableDeal[];
  total: number;
  page: number;
  pageSize: number;
  sort: string;
  direction: "asc" | "desc";
  query: string;
  owner: string;
  stage: string;
  owners: { id: string; full_name: string }[];
  stages: { id: string; name: string; kind: string; position: number }[];
  tags: Option[];
  lostReasons: Option[];
  canExport: boolean;
  canDelete: boolean;
};

type Action = "stage" | "owner" | "tag";

function href(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  return `/deals/table?${search}`;
}

function displayDate(value: string | null, withTime = true) {
  if (!value) return "Нет даты";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Chisinau",
    day: "2-digit",
    month: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(value));
}

// Метки не ужимаются друг под друга: «КВ… septem… til…» не читается ни как
// метка, ни как счёт. Целиком показывается столько меток, сколько помещается
// в колонку, остальные сворачиваются в «+N»; полный список — в подсказке.
const TAGS_BUDGET = 19; // символов в колонке меток
const TAGS_MORE_COST = 3; // место под «+N»

function pickTags(tags: string[]) {
  const cost = (tag: string) => tag.length + 2; // паддинг пилюли и зазор
  const shown: string[] = [];
  let used = 0;
  for (const tag of tags) {
    if (shown.length > 0 && used + cost(tag) > TAGS_BUDGET) break;
    shown.push(tag);
    used += cost(tag);
  }
  while (shown.length > 1 && shown.length < tags.length && used > TAGS_BUDGET - TAGS_MORE_COST) {
    used -= cost(shown.pop() as string);
  }
  return { shown, hidden: tags.length - shown.length };
}

function TagCell({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  const { shown, hidden } = pickTags(tags);
  return (
    <div className={styles.tags} title={tags.join(" · ")}>
      {shown.map((tag) => <span key={tag}>{tag}</span>)}
      {hidden > 0 && <span className={styles.tagsMore}>+{hidden}</span>}
    </div>
  );
}

function csvCell(value: string) {
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

// Компактный аватар контакта: инициалы из реального имени, оттенок —
// детерминированный хеш имени по существующим hue-токенам, новых данных нет.
const AVATAR_HUES: readonly StageHue[] = [
  "blue",
  "cyan",
  "green",
  "olive",
  "amber",
  "pink",
  "violet",
  "magenta",
];

function contactInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "·";
  const first = parts[0]?.charAt(0) ?? "";
  const second = parts.length > 1 ? (parts[1]?.charAt(0) ?? "") : "";
  return `${first}${second}`.toUpperCase();
}

function avatarHue(name: string): StageHue {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return AVATAR_HUES[hash % AVATAR_HUES.length] ?? "grey";
}

function ContactAvatar({ name }: { name: string }) {
  const vars = stageHueVars(avatarHue(name));
  return (
    <span
      aria-hidden="true"
      className={styles.avatar}
      style={{ background: vars.bg, color: vars.text }}
    >
      {contactInitials(name)}
    </span>
  );
}

const SORT_LABELS: Record<string, string> = {
  contact: "Контакт",
  stage: "Этап",
  tags: "Метки",
  task: "Следующий шаг",
  activity: "Последняя активность",
  created: "Создана",
  owner: "Ответственный",
};
const DEFAULT_SORT = "activity";
const DEFAULT_DIRECTION = "desc";

export function DealsTableView(p: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<Action | null>(null);
  const [choice, setChoice] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [deleteRow, setDeleteRow] = useState<TableDeal | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const header = useRef<HTMLInputElement>(null);
  const rowsIds = p.rows.map((row) => row.id);
  const allSelected = rowsIds.length > 0 && rowsIds.every((id) => selected.has(id));
  const count = selected.size;
  const common = {
    q: p.query,
    owner: p.owner,
    stage: p.stage,
    sort: p.sort,
    dir: p.direction,
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSelected(new Set());
      setAction(null);
      setChoice("");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [p.page, p.query, p.owner, p.stage, p.sort, p.direction]);

  useEffect(() => {
    if (header.current) header.current.indeterminate = count > 0 && !allSelected;
  }, [allSelected, count]);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runAction() {
    if (!action || !choice || pending || count === 0) return;
    setPending(true);
    setMessage(null);
    const db = createClient();
    const failures: string[] = [];
    let success = 0;
    for (const row of p.rows.filter((item) => selected.has(item.id))) {
      let error: string | null = null;
      if (action === "stage") {
        const result = await db.rpc("transition_crm_deal", {
          p_deal_id: row.id,
          p_stage_id: choice,
          p_owner_id: row.ownerId ?? null,
          p_lost_reason_id: null,
          p_lost_comment: null,
          p_qualification: null,
          p_task_title: null,
          p_task_due_at: null,
          p_task_type_id: null,
          p_task_assignee_id: null,
        });
        error = result.error?.message ?? null;
      } else if (action === "owner") {
        const result = await db.from("deals").update({ owner_id: choice }).eq("id", row.id);
        error = result.error?.message ?? null;
      } else {
        const result = await db
          .from("deal_tags")
          .upsert({ deal_id: row.id, tag_id: choice }, { onConflict: "deal_id,tag_id" });
        error = result.error?.message ?? null;
      }
      if (error) failures.push(`${row.contact}: ${error}`);
      else success += 1;
    }
    setPending(false);
    setAction(null);
    setChoice("");
    setSelected(new Set());
    setMessage(
      failures.length
        ? `Завершено с ошибками: успешно ${success} из ${success + failures.length}`
        : `Готово: ${success} сделок обновлено`,
    );
    router.refresh();
  }

  async function deleteDeal() {
    if (!deleteRow || deletePending) return;
    setDeletePending(true);
    const result = await createClient().rpc("soft_delete_crm_record", {
      p_entity: "deals",
      p_id: deleteRow.id,
    });
    if (result.error) setMessage(`Не удалось удалить сделку: ${result.error.message}`);
    else {
      setDeleteRow(null);
      router.refresh();
    }
    setDeletePending(false);
  }

  function exportCsv() {
    if (!p.canExport || count === 0) return;
    const selectedRows = p.rows.filter((row) => selected.has(row.id));
    const lines = [
      ["ID", "Контакт", "Этап", "Метки", "Следующий шаг", "Последняя активность", "Создана", "Ответственный"].join(","),
      ...selectedRows.map((row) =>
        [
          row.id,
          row.contact,
          row.stage,
          row.tags.join(" · "),
          row.task,
          row.activity,
          displayDate(row.created),
          row.owner,
        ].map(csvCell).join(","),
      ),
    ];
    const url = URL.createObjectURL(new Blob([`\ufeff${lines.join("\n")}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "deals.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  const pages = Math.max(1, Math.ceil(p.total / p.pageSize));
  const sortLink = (field: string) =>
    href({
      ...common,
      sort: field,
      dir: p.sort === field && p.direction === "asc" ? "desc" : "asc",
      page: undefined,
    });
  const actionOptions = action === "stage"
    ? p.stages
    : action === "owner"
      ? p.owners.map((item) => ({ id: item.id, name: item.full_name }))
      : p.tags;

  return (
    <div className={styles.wrap}>
      <Form className={styles.filters} action="/deals/table" key={`${p.query}|${p.owner}|${p.stage}|${p.sort}|${p.direction}`}>
        <input name="q" defaultValue={p.query} placeholder="Поиск по сделкам" aria-label="Поиск по сделкам" />
        <select name="owner" defaultValue={p.owner} aria-label="Ответственный">
          <option value="">Все ответственные</option>
          {p.owners.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}
        </select>
        <select name="stage" defaultValue={p.stage} aria-label="Этап">
          <option value="">Все этапы</option>
          {p.stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <input type="hidden" name="sort" value={p.sort} />
        <input type="hidden" name="dir" value={p.direction} />
        <button type="submit" className="btn btn-primary">Применить</button>
        {(p.query || p.owner || p.stage) && <Link href="/deals/table">Сбросить</Link>}
        <span className={styles.sortChip} title="Активная сортировка">
          <ArrowDownUp size={12} aria-hidden="true" />
          Сортировка: {SORT_LABELS[p.sort] ?? p.sort}
          {p.direction === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
          {(p.sort !== DEFAULT_SORT || p.direction !== DEFAULT_DIRECTION) && (
            <Link
              href={href({ q: p.query, owner: p.owner, stage: p.stage, sort: DEFAULT_SORT, dir: DEFAULT_DIRECTION })}
              aria-label="Сбросить сортировку"
            >
              <X size={12} />
            </Link>
          )}
        </span>
      </Form>
      {p.rows.length === 0 ? (
        <div className={styles.empty}>
          <strong>Сделки не найдены</strong>
          <span>Измените фильтры или поисковый запрос.</span>
          <Link href="/deals">Открыть воронку</Link>
        </div>
      ) : (
        <div className={`${styles.scroll} ${count > 0 ? styles.scrollWithBulk : ""}`}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.selectCell}><input ref={header} type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rowsIds))} aria-label="Выбрать все видимые сделки" /></th>
                {(["Контакт", "Этап", "Метки", "Следующий шаг", "Последняя активность", "Создана", "Ответственный"] as const).map((label, index) => {
                  const field = ["contact", "stage", "tags", "task", "activity", "created", "owner"][index];
                  const active = p.sort === field;
                  return <th key={field}><Link href={sortLink(field)}>{label}{active && (p.direction === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</Link></th>;
                })}
                <th className={styles.menuCell} aria-label="Действия" />
              </tr>
            </thead>
            <tbody className="motion-list">
              {p.rows.map((row, index) => (
                <tr
                  key={row.id}
                  className={selected.has(row.id) ? styles.selectedRow : undefined}
                  style={{ "--i": index } as CSSProperties}
                  tabIndex={0}
                  // Cmd-клик и клик колесом по строке — привычный способ открыть
                  // сделку рядом, не теряя место в таблице. <tr> ссылкой не бывает.
                  onClick={(event) => { if (event.metaKey || event.ctrlKey) { window.open(`/deals/${row.id}`, "_blank", "noopener"); return; } startRouteProgress(); router.push(`/deals/${row.id}`); }}
                  onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); window.open(`/deals/${row.id}`, "_blank", "noopener"); } }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      startRouteProgress();
                      router.push(`/deals/${row.id}`);
                    }
                  }}
                >
                  <td className={styles.selectCell} onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} aria-label={`Выбрать сделку ${row.contact}`} /></td>
                  <td><Link className={styles.contact} href={`/deals/${row.id}`} onClick={(event) => event.stopPropagation()} title={row.contact}><span className={styles.contactCell}><ContactAvatar name={row.contact} /><span className={styles.truncate}>{row.contact}</span></span></Link></td>
                  <td title={row.stage}><StageIndicator hue={row.stageHue} name={row.stage} variant="inline" /></td>
                  <td><TagCell tags={row.tags} /></td>
                  <td className={styles.truncate} title={row.task}>{row.task && <>{row.task} · {displayDate(row.taskDueAt)}</>}</td>
                  <td className={styles.activity} title={row.activity}>{row.activity}{row.activityAt && ` · ${displayDate(row.activityAt)}`}</td>
                  <td className={styles.muted}>{displayDate(row.created, false)}</td>
                  <td className={styles.truncate} title={row.owner}>{row.owner}</td>
                  <td className={styles.menuCell} onClick={(event) => event.stopPropagation()}>
                    {p.canDelete && <button type="button" className={styles.menuButton} aria-label={`Удалить сделку ${row.contact}`} onClick={() => setDeleteRow(row)}><MoreHorizontal size={14} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={9} className={styles.totalCell}>
                  Показано {p.rows.length} из {p.total}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <nav className={styles.pagination} aria-label="Пагинация">
        <span>Страница {p.page + 1} из {pages} · найдено {p.total}</span>
        <span className={styles.pageLinks}>
          {p.page > 0 && <Link href={href({ ...common, page: p.page - 1 })}><ChevronLeft size={16} />Назад</Link>}
          {p.page + 1 < pages && <Link href={href({ ...common, page: p.page + 1 })}>Вперёд<ChevronRight size={16} /></Link>}
        </span>
      </nav>
      {count > 0 && <div className={styles.bulkSpacer} aria-hidden="true" />}
      {message && <div className={styles.message} role="status">{message}</div>}
      {count > 0 && <div className={styles.bulk} role="toolbar" aria-label="Массовые действия">
        <strong>Выбрано {count}</strong>
        <button type="button" disabled={pending} onClick={() => setAction("stage")}>Этап</button>
        <button type="button" disabled={pending} onClick={() => setAction("owner")}>Ответственный</button>
        <button type="button" disabled={pending} onClick={() => setAction("tag")}>Метка</button>
        {p.canExport && <button type="button" disabled={pending} onClick={exportCsv}>Выгрузить</button>}
        <button type="button" disabled={pending} aria-label="Снять выделение" onClick={() => setSelected(new Set())}><X size={16} /></button>
      </div>}
      {action && <div className={`${styles.dialogBackdrop} motion-veil`} role="presentation"><div className={`${styles.dialog} motion-dialog`} role="dialog" aria-modal="true" aria-label="Массовое действие">
        <button type="button" className={styles.close} onClick={() => setAction(null)} aria-label="Закрыть"><X size={16} /></button>
        <h2>{action === "stage" ? "Сменить этап" : action === "owner" ? "Назначить ответственного" : "Добавить метку"}</h2>
        <select autoFocus value={choice} onChange={(event) => setChoice(event.target.value)}><option value="">Выберите…</option>{actionOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <div className={styles.dialogActions}><button type="button" onClick={() => setAction(null)}>Отмена</button><button type="button" disabled={!choice || pending} onClick={() => void runAction()}>Подтвердить</button></div>
      </div></div>}
      {deleteRow && <div className={`${styles.dialogBackdrop} motion-veil`} role="presentation"><div className={`${styles.dialog} motion-dialog`} role="dialog" aria-modal="true" aria-labelledby="delete-deal-title">
        <h2 id="delete-deal-title">Удалить сделку?</h2>
        <p>Сделка «{deleteRow.contact}» будет перемещена в корзину.</p>
        <div className={styles.dialogActions}><button type="button" disabled={deletePending} onClick={() => setDeleteRow(null)}>Отмена</button><button type="button" disabled={deletePending} onClick={() => void deleteDeal()}>Удалить</button></div>
      </div></div>}
    </div>
  );
}
