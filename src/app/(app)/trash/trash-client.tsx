"use client";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArchiveRestore } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./trash.module.css";
import { countWord } from "@/lib/plural";
export type TrashRow = {
  entity: "deals" | "contacts" | "notes" | "tasks";
  id: string;
  label: string;
  deleted_at: string;
  deleted_by: string;
  deleted_by_name: string | null;
};
const filters = [
  { key: "all", label: "Всё" },
  { key: "deals", label: "Сделки" },
  { key: "contacts", label: "Контакты" },
  { key: "notes", label: "Примечания" },
  { key: "tasks", label: "Задачи" },
];
const labels: Record<TrashRow["entity"], string> = {
  deals: "Сделка",
  contacts: "Контакт",
  notes: "Примечание",
  tasks: "Задача",
};
const daysLeft = (date: string, asOf: string) =>
  Math.max(
    0,
    30 -
      Math.floor(
        (new Date(asOf).getTime() - new Date(date).getTime()) / 86400000,
      ),
  );
export default function TrashClient({
  rows,
  total,
  page,
  limit,
  entity,
  canRestore,
  asOf,
}: {
  rows: TrashRow[];
  total: number;
  page: number;
  limit: number;
  entity: string;
  canRestore: boolean;
  asOf: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState(rows);
  const [pending, setPending] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<TrashRow | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [error, setError] = useState("");
  const pendingRef = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!confirm) return;
    previousFocus.current = document.activeElement as HTMLElement;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pendingRef.current) setConfirm(null);
      if (event.key === "Tab" && dialogRef.current) {
        const buttons =
          dialogRef.current.querySelectorAll<HTMLElement>("button");
        if (
          buttons.length &&
          event.shiftKey &&
          document.activeElement === buttons[0]
        ) {
          event.preventDefault();
          buttons[buttons.length - 1].focus();
        } else if (
          buttons.length &&
          (document.activeElement === dialogRef.current ||
            document.activeElement === buttons[buttons.length - 1])
        ) {
          event.preventDefault();
          buttons[0].focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previousFocus.current?.focus();
    };
  }, [confirm]);
  async function restore(row: TrashRow) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(row.id);
    setError("");
    try {
      const response = await fetch("/api/trash/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entity: row.entity, id: row.id }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Не удалось восстановить запись");
      setItems((current) => current.filter((item) => item.id !== row.id));
      setConfirm(null);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось восстановить запись",
      );
    } finally {
      pendingRef.current = false;
      setPending(null);
    }
  }
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Корзина</h1>
          <p className={styles.subtitle}>
            Восстановить запись можно в течение 30 дней.
          </p>
        </div>
      </header>
      <div className={styles.toolbar}>
        <nav className={styles.filters} aria-label="Фильтр корзины">
          {filters.map((filter) => (
            <Link
              key={filter.key}
              className={entity === filter.key ? styles.selected : ""}
              href={`/trash?entity=${filter.key}`}
            >
              {filter.label}
            </Link>
          ))}
        </nav>
        <div className={styles.toolbarActions}><span className={styles.count}>{countWord(total, "запись", "записи", "записей")}</span><button className={styles.clearButton} onClick={() => setClearOpen(true)} disabled={total === 0}>Очистить корзину</button></div>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          <AlertCircle size={15} /> {error}
        </p>
      )}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Что</th>
              <th>Тип</th>
              <th>Удалил</th>
              <th>Когда</th>
              <th>Осталось</th>
              <th>Действие</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => {
              const days = daysLeft(row.deleted_at, asOf);
              return (
                <tr key={`${row.entity}-${row.id}`}>
                  <td>{row.label}</td>
                  <td>{labels[row.entity]}</td>
                  <td>{row.deleted_by_name || row.deleted_by}</td>
                  <td>
                    {new Intl.DateTimeFormat("ru-RU", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "Europe/Chisinau",
                    }).format(new Date(row.deleted_at))}
                  </td>
                  <td className={days < 3 ? styles.urgent : ""}>{days} дн</td>
                  <td>
                    {canRestore && (
                      <button
                        className={styles.restore}
                        disabled={pending === row.id || days === 0}
                        onClick={() => setConfirm(row)}
                      >
                        <ArchiveRestore size={14} /> Вернуть
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr className={styles.emptyRow}>
                <td colSpan={6}>
                  Корзина пуста. Удалённые сделки, контакты, примечания и задачи
                  лежат здесь тридцать дней — их можно вернуть.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <nav className={styles.pagination} aria-label="Страницы">
          {page > 1 && (
            <Link href={`/trash?entity=${entity}&page=${page - 1}`}>Назад</Link>
          )}
          <span>
            Страница {page} из {pages}
          </span>
          {page < pages && (
            <Link href={`/trash?entity=${entity}&page=${page + 1}`}>
              Дальше
            </Link>
          )}
        </nav>
      )}
      {confirm && (
        <div className={styles.backdrop}>
          <section
            className={styles.dialog}
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="restore-title"
          >
            <h2 id="restore-title">Вернуть запись?</h2>
            <p>
              Запись «{confirm.label}» будет восстановлена в{" "}
              {labels[confirm.entity].toLowerCase()}.
            </p>
            <div>
              <button onClick={() => setConfirm(null)}>Отмена</button>
              <button
                className={styles.primary}
                disabled={pending !== null}
                onClick={() => restore(confirm)}
              >
                Вернуть
              </button>
            </div>
          </section>
        </div>
      )}
      {clearOpen && (
        <div className={`${styles.backdrop} motion-veil`} onMouseDown={(event) => event.target === event.currentTarget && setClearOpen(false)}>
          <section className={`${styles.dialog} motion-dialog`} role="dialog" aria-modal="true" aria-labelledby="clear-trash-title">
            <h2 id="clear-trash-title">Очистить корзину?</h2>
            <p>После окончательного удаления восстановить записи нельзя. Вместе со сделками исчезнут связанные данные:</p>
            <ul className={styles.consequences}>
              <li>{items.filter((row) => row.entity === "notes").length} примечаний</li>
              <li>{items.filter((row) => row.entity === "tasks").length} задач</li>
              <li>звонки и история этапов — останутся в журнале</li>
            </ul>
            <p className={styles.clearNotice}>Окончательная очистка выполняется автоматически через 30 дней. Ручное стирание сейчас недоступно.</p>
            <div><button onClick={() => setClearOpen(false)}>Понятно</button></div>
          </section>
        </div>
      )}
    </div>
  );
}
