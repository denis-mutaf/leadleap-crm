"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  X,
} from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
export type TableDeal = {
  id: string;
  contact: string;
  stage: string;
  stageKind: string;
  projects: string[];
  object: string;
  budget: number | null;
  currency: string;
  task: string;
  owner: string;
  source: string;
  updated: string;
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
  stages: { id: string; name: string; kind: string }[];
  tags: Option[];
  lostReasons: Option[];
  canExport: boolean;
  canDelete: boolean;
};
function href(p: Record<string, string | number | undefined>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(p))
    if (v !== undefined && v !== "") s.set(k, String(v));
  return `/deals/table?${s}`;
}
function money(v: number | null, c: string) {
  return v === null
    ? "—"
    : `${c === "EUR" ? "€" : c} ${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(v)}`;
}
function date(v: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(v));
}
function cell(v: string) {
  const x = /^[\s\u0000-\u001f]*[=+\-@]/.test(v) ? `'${v}` : v;
  return `"${x.replaceAll('"', '""')}"`;
}
function isValidCount(value: number | null): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
export function DealsTableView(p: Props) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set()),
    [action, setAction] = useState<"stage" | "owner" | "tag" | null>(null),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState<string | null>(null),
    [failed, setFailed] = useState<string[]>([]),
    header = useRef<HTMLInputElement>(null),
    pendingRef = useRef(false);
  const [choice, setChoice] = useState<{
    kind: "stage" | "owner" | "tag";
    value: string;
  } | null>(null);
  const [lostReason, setLostReason] = useState("");
  const [deleteRow, setDeleteRow] = useState<TableDeal | null>(null);
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteCounts, setDeleteCounts] = useState<{
    notes: number;
    tasks: number;
    calls: number;
  } | null>(null);
  const [deleteCountsLoading, setDeleteCountsLoading] = useState(false);
  const [deleteCountsError, setDeleteCountsError] = useState(false);
  const deleteLock = useRef(false);
  const deleteCountsSequence = useRef(0);
  const deleteModal = useRef<HTMLDivElement>(null);
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const ids = p.rows.map((r) => r.id),
    count = sel.size,
    all = ids.length > 0 && ids.every((id) => sel.has(id));
  useEffect(() => {
    const t = setTimeout(() => {
      setSel(new Set());
      setAction(null);
      setMessage(null);
      setFailed([]);
    }, 0);
    return () => clearTimeout(t);
  }, [p.page, p.query, p.owner, p.stage, p.sort, p.direction]);
  useEffect(() => {
    if (header.current) header.current.indeterminate = count > 0 && !all;
  }, [count, all]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending && !deletePending) {
        setAction(null);
        setSel(new Set());
        setDeleteRow(null);
        setDeleteError(null);
        setRowMenuId(null);
        deleteCountsSequence.current += 1;
        setDeleteCountsLoading(false);
        deleteTrigger.current?.focus();
      }
    };
    addEventListener("keydown", f);
    return () => removeEventListener("keydown", f);
  }, [pending, deletePending]);
  const toggle = (id: string) =>
    setSel((s) => {
      if (pendingRef.current) return s;
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  async function run(kind: "stage" | "owner" | "tag", value: string) {
    if (!count || pendingRef.current) return;
    const selectedRows = p.rows.filter((row) => sel.has(row.id));
    const totalSelected = selectedRows.length;
    pendingRef.current = true;
    setPending(true);
    setMessage(null);
    const successIds = new Set<string>();
    const failureById = new Map<string, string>();
    try {
      const db = createClient();
      for (const row of selectedRows) {
        let error: string | undefined;
        try {
          if (kind === "stage") {
            const target = p.stages.find((x) => x.id === value);
            let reason: null | string = null;
            if (target?.kind === "lost") {
              reason = lostReason || null;
              if (!reason) {
                failureById.set(
                  row.id,
                  `${row.contact}: причина отказа не указана`,
                );
                continue;
              }
            }
            const r = await db.rpc("transition_crm_deal", {
              p_deal_id: row.id,
              p_stage_id: value,
              p_owner_id: row.ownerId ?? null,
              p_lost_reason_id: reason,
              p_lost_comment: null,
              p_qualification: null,
              p_task_title: null,
              p_task_due_at: null,
              p_task_type_id: null,
              p_task_assignee_id: null,
            });
            const data = r.data as unknown;
            const confirmed =
              typeof data === "object" &&
              data !== null &&
              "id" in data &&
              "stage_id" in data &&
              data.id === row.id &&
              data.stage_id === value;
            error =
              r.error?.message ??
              (!confirmed
                ? "Переход не подтверждён или gate отклонил операцию"
                : undefined);
          } else if (kind === "owner") {
            const r = await db
              .from("deals")
              .update({ owner_id: value })
              .eq("id", row.id)
              .select("id")
              .maybeSingle();
            error =
              r.error?.message ??
              (!r.data ? "RLS не подтвердил обновление" : undefined);
          } else {
            const r = await db
              .from("deal_tags")
              .upsert(
                { deal_id: row.id, tag_id: value },
                { onConflict: "deal_id,tag_id" },
              )
              .select("deal_id")
              .maybeSingle();
            error =
              r.error?.message ??
              (!r.data ? "RLS/trigger не подтвердили метку" : undefined);
          }
        } catch (cause) {
          error = cause instanceof Error ? cause.message : "Сетевая ошибка";
        }
        if (error) failureById.set(row.id, `${row.contact}: ${error}`);
        else successIds.add(row.id);
      }
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "Не удалось выполнить массовое действие";
      for (const row of selectedRows) {
        if (!successIds.has(row.id))
          failureById.set(row.id, `${row.contact}: ${message}`);
      }
    } finally {
      const failures = [...failureById.values()];
      pendingRef.current = false;
      setPending(false);
      setFailed(failures);
      setMessage(
        failures.length
          ? `Завершено с ошибками: успешно ${successIds.size} из ${totalSelected}`
          : `Готово: ${successIds.size} сделок обновлено`,
      );
      setSel(new Set(failureById.keys()));
      setAction(null);
      setChoice(null);
      setLostReason("");
      router.refresh();
    }
  }
  async function deleteDeal() {
    if (
      !deleteRow ||
      deletePending ||
      deleteLock.current ||
      deleteCountsLoading ||
      !deleteCounts
    )
      return;
    deleteLock.current = true;
    setDeletePending(true);
    setDeleteError(null);
    try {
      const result = await createClient().rpc("soft_delete_crm_record", {
        p_entity: "deals",
        p_id: deleteRow.id,
      });
      if (result.error) {
        throw new Error(result.error.message);
      }
      setDeleteRow(null);
      router.refresh();
    } catch (cause) {
      setDeleteError(
        cause instanceof Error ? cause.message : "Не удалось удалить сделку",
      );
    } finally {
      setDeletePending(false);
      deleteLock.current = false;
    }
  }
  async function openDelete(row: TableDeal) {
    if (deletePending || deleteLock.current) return;
    const sequence = ++deleteCountsSequence.current;
    setDeleteError(null);
    setDeleteCounts(null);
    setDeleteCountsError(false);
    setDeleteCountsLoading(true);
    setDeleteRow(row);
    try {
      const db = createClient();
      const [notes, tasks, calls] = await Promise.all([
        db
          .from("notes")
          .select("id", { count: "exact", head: true })
          .eq("deal_id", row.id)
          // Карточка сделки эти заметки не показывает: счёт должен сойтись
          // с тем, что человек увидит, открыв сделку.
          .or("amo_note_type.is.null,amo_note_type.not.in.(call_in,call_out)"),
        db
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("deal_id", row.id),
        db
          .from("calls")
          .select("id", { count: "exact", head: true })
          .eq("deal_id", row.id),
      ]);
      if (notes.error || tasks.error || calls.error)
        throw new Error("Не удалось получить последствия удаления");
      const counts = {
        notes: notes.count,
        tasks: tasks.count,
        calls: calls.count,
      };
      if (
        !isValidCount(counts.notes) ||
        !isValidCount(counts.tasks) ||
        !isValidCount(counts.calls)
      ) {
        throw new Error("Счётчики связанных записей не подтверждены");
      }
      if (sequence !== deleteCountsSequence.current) return;
      setDeleteCounts({
        notes: counts.notes as number,
        tasks: counts.tasks as number,
        calls: counts.calls as number,
      });
    } catch {
      if (sequence === deleteCountsSequence.current) setDeleteCountsError(true);
    } finally {
      if (sequence === deleteCountsSequence.current)
        setDeleteCountsLoading(false);
    }
  }
  useEffect(() => {
    if (!deleteRow || !deleteModal.current) return;
    const modal = deleteModal.current;
    const focusable = modal.querySelectorAll<HTMLElement>(
      "button:not([disabled])",
    );
    focusable[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    modal.addEventListener("keydown", onKeyDown);
    return () => modal.removeEventListener("keydown", onKeyDown);
  }, [deleteRow]);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest(".deal-row-menu-wrap")
      )
        setRowMenuId(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  function exportCsv() {
    if (!p.canExport || !count) return;
    const text =
        "\ufeff" +
        [
          "ID",
          "Контакт",
          "Этап",
          "Объект",
          "Сумма",
          "Ответственный",
          "Канал",
          "Обновлена",
        ].join(",") +
        "\n" +
        p.rows
          .filter((r) => sel.has(r.id))
          .map((r) =>
            [
              r.id,
              r.contact,
              r.stage,
              r.object,
              money(r.budget, r.currency),
              r.owner,
              r.source,
              date(r.updated),
            ]
              .map(cell)
              .join(","),
          )
          .join("\n"),
      a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([text], { type: "text/csv;charset=utf-8" }),
    );
    a.download = "deals.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  const pages = Math.max(1, Math.ceil(p.total / p.pageSize)),
    common = {
      q: p.query,
      owner: p.owner,
      stage: p.stage,
      sort: p.sort,
      dir: p.direction,
    },
    sortLink = (f: "updated" | "budget") =>
      href({
        ...common,
        sort: f,
        dir: p.sort === f && p.direction === "asc" ? "desc" : "asc",
      });
  return (
    <div className="deals-table-wrap">
      <form className="table-filters" method="get">
        <input
          name="q"
          defaultValue={p.query}
          placeholder="Название или объект"
          aria-label="Поиск названия или объекта"
        />
        <select name="owner" defaultValue={p.owner} aria-label="Ответственный">
          <option value="">Все ответственные</option>
          {p.owners.map((x) => (
            <option key={x.id} value={x.id}>
              {x.full_name}
            </option>
          ))}
        </select>
        <select name="stage" defaultValue={p.stage} aria-label="Этап">
          <option value="">Все этапы</option>
          {p.stages.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <button type="submit">Применить</button>
        {(p.query || p.owner || p.stage) && (
          <Link href="/deals/table">Сбросить</Link>
        )}
      </form>
      {p.rows.length === 0 ? (
        <div className="deals-table-empty">
          <strong>Сделки не найдены</strong>
          <span>Измените фильтры или поисковый запрос.</span>
        </div>
      ) : (
        <div className="deals-table-scroll">
          <table className="deals-table">
            <thead>
              <tr>
                <th className="deals-table-select">
                  <input
                    ref={header}
                    type="checkbox"
                    checked={all}
                    disabled={pending}
                    onChange={() => setSel(all ? new Set() : new Set(ids))}
                    aria-label="Выбрать все видимые сделки"
                  />
                </th>
                {[
                  ["Контакт", null],
                  ["Этап", null],
                  ["Проект", null],
                  ["Объект", null],
                  ["Деньги", "budget"],
                  ["Следующий шаг", null],
                  ["Ответственный", null],
                  ["Канал", null],
                  ["Обновлена", "updated"],
                  ["", null],
                ].map(([label, field]) => (
                  <th key={label}>
                    {field ? (
                      <Link href={sortLink(field as "updated" | "budget")}>
                        {label}{" "}
                        {p.sort === field &&
                          (p.direction === "asc" ? (
                            <ArrowUp size={12} />
                          ) : (
                            <ArrowDown size={12} />
                          ))}
                      </Link>
                    ) : (
                      <span>{label}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => (
                <tr
                  key={r.id}
                  className={sel.has(r.id) ? "is-selected" : undefined}
                >
                  <td className="deals-table-select">
                    <input
                      type="checkbox"
                      checked={sel.has(r.id)}
                      disabled={pending}
                      onChange={() => toggle(r.id)}
                      aria-label={`Выбрать сделку ${r.contact}`}
                    />
                  </td>
                  <td>
                    <Link
                      className="deal-table-contact"
                      href={`/deals/${r.id}`}
                      title={r.contact}
                    >
                      {r.contact}
                    </Link>
                  </td>
                  <td>
                    <span className={`deals-table-stage-dot ${r.stageKind}`} />
                    {r.stage}
                  </td>
                  <td>
                    <div className="deals-table-projects">
                      {r.projects.length
                        ? r.projects.map((x) => (
                            <span className="deals-table-chip" key={x}>
                              {x}
                            </span>
                          ))
                        : "—"}
                    </div>
                  </td>
                  <td className="deals-table-truncate">{r.object || "—"}</td>
                  <td className="deals-table-money">
                    {money(r.budget, r.currency)}
                  </td>
                  <td>{r.task || "Нет следующего шага"}</td>
                  <td>{r.owner || "—"}</td>
                  <td>{r.source || "—"}</td>
                  <td className="deals-table-muted">{date(r.updated)}</td>
                  <td>
                    {p.canDelete && (
                      <div className="deal-row-menu-wrap">
                        <button
                          type="button"
                          className="deal-row-menu"
                          aria-haspopup="menu"
                          aria-expanded={rowMenuId === r.id}
                          aria-label={`Открыть меню сделки ${r.contact}`}
                          onClick={() =>
                            setRowMenuId(rowMenuId === r.id ? null : r.id)
                          }
                        >
                          <MoreHorizontal size={14} />
                        </button>
                        {rowMenuId === r.id && (
                          <div className="deal-row-menu-popover" role="menu">
                            <button
                              type="button"
                              role="menuitem"
                              onClick={(event) => {
                                deleteTrigger.current = event.currentTarget
                                  .closest(".deal-row-menu-wrap")
                                  ?.querySelector(
                                    ".deal-row-menu",
                                  ) as HTMLButtonElement | null;
                                void openDelete(r);
                                setRowMenuId(null);
                              }}
                            >
                              Удалить сделку
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <nav className="table-pagination" aria-label="Пагинация">
        <span>
          Страница {p.page + 1} из {pages} · найдено {p.total}
        </span>
        <span>
          {p.page > 0 && (
            <Link href={href({ ...common, page: p.page - 1 })}>
              <ChevronLeft size={16} />
              Назад
            </Link>
          )}
          {p.page + 1 < pages && (
            <Link href={href({ ...common, page: p.page + 1 })}>
              Вперёд
              <ChevronRight size={16} />
            </Link>
          )}
        </span>
      </nav>
      {message && (
        <div role="status" className="bulk-message">
          {message}
          {failed.length > 0 && (
            <ul>
              {failed.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {count > 0 && (
        <div
          className="bulk-actions"
          role="toolbar"
          aria-label="Массовые действия"
        >
          <strong>Выбрано {count}</strong>
          <button disabled={pending} onClick={() => setAction("stage")}>
            Этап
          </button>
          <button disabled={pending} onClick={() => setAction("owner")}>
            Ответственный
          </button>
          <button disabled={pending} onClick={() => setAction("tag")}>
            Метка
          </button>
          {p.canExport && (
            <button disabled={pending} onClick={exportCsv}>
              Выгрузить
            </button>
          )}
          <button
            aria-label="Снять выделение"
            disabled={pending}
            onClick={() => setSel(new Set())}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {deleteRow && (
        <div className="bulk-confirm-backdrop" role="presentation">
          <div
            className="bulk-confirm"
            ref={deleteModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-deal-title"
          >
            <h2 id="delete-deal-title">Удалить сделку?</h2>
            <p>Сделка «{deleteRow.contact}» будет перемещена в корзину.</p>
            {deleteCountsLoading ? (
              <p>Считаем связанные записи…</p>
            ) : deleteCountsError ? (
              <p>
                Количество связанных примечаний, задач и звонков сейчас
                недоступно. После удаления они будут скрыты вместе со сделкой.
              </p>
            ) : (
              deleteCounts && (
                <ul>
                  <li>{deleteCounts.notes} примечаний</li>
                  <li>{deleteCounts.tasks} задач</li>
                  <li>{deleteCounts.calls} звонков</li>
                  <li>
                    История этапов сохранится и вернётся вместе со сделкой при
                    восстановлении.
                  </li>
                </ul>
              )
            )}
            <p>Восстановить сделку можно в течение 30 дней.</p>
            {deleteError && (
              <div role="alert" className="bulk-message">
                {deleteError}
              </div>
            )}
            <div className="bulk-confirm-actions">
              <button
                type="button"
                disabled={deletePending}
                onClick={() => {
                  deleteCountsSequence.current += 1;
                  setDeleteCountsLoading(false);
                  setDeleteRow(null);
                  deleteTrigger.current?.focus();
                }}
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={
                  deletePending ||
                  deleteCountsLoading ||
                  !deleteCounts ||
                  deleteCountsError
                }
                onClick={() => void deleteDeal()}
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
      {action && (
        <div
          className="bulk-popover"
          role="dialog"
          aria-label="Выбор массового действия"
        >
          <button
            className="bulk-close"
            onClick={() => setAction(null)}
            aria-label="Закрыть"
          >
            ×
          </button>
          <select
            autoFocus
            defaultValue=""
            onChange={(e) => {
              if (e.target.value)
                setChoice({ kind: action, value: e.target.value });
            }}
          >
            <option value="">Выберите…</option>
            {(action === "stage"
              ? p.stages
              : action === "owner"
                ? p.owners.map((x) => ({ id: x.id, name: x.full_name }))
                : p.tags
            ).map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {choice && (
        <div className="bulk-confirm-backdrop" role="presentation">
          <div
            className="bulk-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-confirm-title"
          >
            <h2 id="bulk-confirm-title">Подтвердить массовое действие</h2>
            <p>
              {choice.kind === "stage"
                ? "Сменить этап"
                : choice.kind === "owner"
                  ? "Назначить ответственного"
                  : "Добавить метку"}{" "}
              для {count} выбранных сделок?
            </p>
            {choice.kind === "stage" &&
              p.stages.find((stage) => stage.id === choice.value)?.kind ===
                "lost" && (
                <label>
                  Причина отказа
                  <select
                    value={lostReason}
                    onChange={(event) => setLostReason(event.target.value)}
                    autoFocus
                  >
                    <option value="">Выберите причину…</option>
                    {p.lostReasons.map((reason) => (
                      <option key={reason.id} value={reason.id}>
                        {reason.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            <div className="bulk-confirm-actions">
              <button
                type="button"
                onClick={() => {
                  setChoice(null);
                  setLostReason("");
                }}
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={
                  pending ||
                  (choice.kind === "stage" &&
                    p.stages.find((stage) => stage.id === choice.value)
                      ?.kind === "lost" &&
                    !lostReason)
                }
                onClick={() => void run(choice.kind, choice.value)}
              >
                Подтвердить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
