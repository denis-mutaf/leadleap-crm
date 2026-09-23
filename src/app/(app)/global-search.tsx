"use client";
import { BriefcaseBusiness, ListTodo, Search, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { dbErrorText } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/client";
import { useNavCollapsed } from "./nav-collapse";

type Result = {
  id: string;
  kind: "contact" | "deal" | "task";
  title: string;
  meta?: string;
  href: string;
};
type SearchRow = {
  kind: "contact" | "deal" | "task";
  id: string;
  title: string;
  meta: string | null;
  deal_id: string | null;
};
const LIMIT = 8,
  digits = (value: string) => value.replace(/\D/g, ""),
  isPhone = (value: string) => /^[\d\s+()\-]+$/.test(value);
const highlight = (value: string, query: string): ReactNode => {
  const term = query.trim();
  if (!term) return value;
  const parts = value.split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"));
  return parts.map((part, index) =>
    part.toLowerCase() === term.toLowerCase() ? <mark key={index}>{part}</mark> : part,
  );
};

export function GlobalSearch() {
  const navCollapsed = useNavCollapsed();
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [groups, setGroups] = useState<
      { label: string; icon: typeof Users; items: Result[] }[]
    >([]),
    [error, setError] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [selected, setSelected] = useState(0),
    [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null),
    triggerRef = useRef<HTMLButtonElement>(null),
    requestId = useRef(0),
    router = useRouter(),
    flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const invalidate = () => {
    requestId.current += 1;
  };
  const close = () => {
    invalidate();
    setOpen(false);
    setQuery("");
    setGroups([]);
    setError(null);
    setLoading(false);
    triggerRef.current?.focus();
  };
  const go = (item: Result) => {
    const value = query.trim();
    if (value) {
      const next = [value, ...recent.filter((entry) => entry !== value)].slice(0, 5);
      setRecent(next);
      window.localStorage.setItem("leadleap-search-recent", JSON.stringify(next));
    }
    close();
    router.push(item.href);
  };

  // Недавние запросы лежат в localStorage — на сервере его нет, и прочитать
  // их можно только после монтирования. Это ровно тот случай, для которого
  // эффект и существует: синхронизация с внешним хранилищем. Правило
  // set-state-in-effect отличить его от лишнего прохода рендера не умеет.
  useEffect(() => {
    let stored: unknown = [];
    try {
      stored = JSON.parse(window.localStorage.getItem("leadleap-search-recent") ?? "[]");
    } catch {
      stored = [];
    }
    const list = Array.isArray(stored)
      ? stored.filter((value): value is string => typeof value === "string").slice(0, 5)
      : [];
    if (list.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecent(list);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        !open &&
        event.key === "/" &&
        !["INPUT", "TEXTAREA"].includes((event.target as HTMLElement).tagName)
      ) {
        event.preventDefault();
        setOpen(true);
        return;
      }
      if (!open) return;
      if (event.key === "Escape") close();
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelected((n) => Math.min(n + 1, Math.max(flat.length - 1, 0)));
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelected((n) => Math.max(n - 1, 0));
      }
      if (event.key === "Enter" && flat[selected]) {
        event.preventDefault();
        go(flat[selected]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const value = query.trim(),
      phone = isPhone(value),
      phoneDigits = digits(value);
    invalidate();
    const current = requestId.current;
    queueMicrotask(() => {
      if (current === requestId.current) setGroups([]);
    });
    if (value.length < 2 || (phone && phoneDigits.length < 4)) {
      queueMicrotask(() => {
        setGroups([]);
        setError(null);
        setLoading(false);
      });
      return;
    }
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        // Один вызов: телефон нормализует и ищет по всем цифрам база
        // (crm_global_search), она же подписывает сделку этапом.
        const result = await createClient().rpc("crm_global_search", {
          p_q: value,
          p_limit: LIMIT,
        });
        if (current !== requestId.current) return;
        if (result.error) throw result.error;
        const rows = (result.data ?? []) as SearchRow[];
        const pick = (kind: SearchRow["kind"]) => rows.filter((row) => row.kind === kind);
        const next: { label: string; icon: typeof Users; items: Result[] }[] = [];
        const contacts = pick("contact");
        if (contacts.length)
          next.push({
            label: "Контакты",
            icon: Users,
            items: contacts.map((row) => ({
              id: row.id,
              kind: "contact",
              title: row.title,
              meta: row.meta ?? undefined,
              href: `/contacts/${row.id}`,
            })),
          });
        const deals = pick("deal");
        if (deals.length)
          next.push({
            label: "Сделки",
            icon: BriefcaseBusiness,
            items: deals.map((row) => ({
              id: row.id,
              kind: "deal",
              title: row.title,
              meta: row.meta ?? undefined,
              href: `/deals/${row.id}`,
            })),
          });
        const tasks = pick("task");
        if (tasks.length)
          next.push({
            label: "Задачи",
            icon: ListTodo,
            items: tasks.map((row) => ({
              id: row.id,
              kind: "task",
              title: row.title,
              meta: row.meta ?? undefined,
              href: row.deal_id ? `/deals/${row.deal_id}` : "/tasks",
            })),
          });
        setGroups(next);
        setSelected(0);
      } catch (cause) {
        if (current === requestId.current)
          setError(dbErrorText(cause, "Не удалось выполнить поиск"));
      } finally {
        if (current === requestId.current) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      invalidate();
    };
  }, [open, query]);
  return (
    <>
      <button
        ref={triggerRef}
        className="global-search-trigger"
        onClick={() => setOpen(true)}
        aria-label="Открыть поиск"
        title={navCollapsed ? "Поиск" : undefined}
      >
        <Search size={15} />
        <span>Поиск</span>
        <kbd>/</kbd>
      </button>
      {open && (
        <div
          className="global-search-overlay motion-veil"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <section
            className="global-search-panel motion-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Глобальный поиск"
          >
            <div className="global-search-field">
              <Search size={16} />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск по CRM"
                aria-label="Поиск по CRM"
              />
              <kbd>ESC</kbd>
              <button onClick={close} aria-label="Закрыть поиск">
                <X size={16} />
              </button>
            </div>
            <div className="global-search-results" aria-live="polite">
              {loading && <p className="global-search-state">Ищем…</p>}
              {error && (
                <p className="global-search-error">Ошибка поиска: {error}</p>
              )}
              {!loading &&
                !error &&
                query.trim().length >= 2 &&
                !flat.length && (
                  <p className="global-search-state">Ничего не найдено</p>
                )}
              {groups.map((group) => (
              <div key={group.label}>
                  <div className="global-search-group">
                    <group.icon size={14} />
                    {group.label}
                    <span className="global-search-count">{group.items.length}</span>
                  </div>
                  {group.items.map((item) => {
                    const Icon =
                        item.kind === "contact"
                          ? Users
                          : item.kind === "deal"
                            ? BriefcaseBusiness
                            : ListTodo,
                      index = flat.indexOf(item);
                    return (
                      <button
                        key={`${item.kind}-${item.id}`}
                        className={`global-search-row ${index === selected ? "is-selected" : ""}`}
                        onMouseEnter={() => setSelected(index)}
                        onClick={() => go(item)}
                      >
                        <Icon size={15} />
                        <span>{highlight(item.title, query)}</span>
                        <small>{item.meta}</small>
                      </button>
                    );
                  })}
                </div>
              ))}
              {!loading && !error && !query.trim() && recent.length > 0 && (
                <div>
                  <div className="global-search-group"><Search size={14} /> Недавние запросы</div>
                  {recent.map((entry) => (
                    <button
                      className="global-search-row"
                      key={entry}
                      onClick={() => setQuery(entry)}
                    >
                      <Search size={15} />
                      <span>{entry}</span>
                    </button>
                  ))}
                </div>
              )}
              {!loading && !error && !query.trim() && !recent.length && (
                <p className="global-search-state">Введите имя, номер, сделку или объект</p>
              )}
            </div>
            <footer className="global-search-footer">
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd> выбрать <kbd>Enter</kbd> открыть
              </span>
              <span>Имя, номер, сделка, объект и открытые задачи</span>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
