"use client";
import { BriefcaseBusiness, ListTodo, Search, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";

type Result = {
  id: string;
  kind: "contact" | "deal" | "task";
  title: string;
  meta?: string;
  href: string;
};
type Row = {
  id: string;
  title: string;
  due_at?: string;
  deal_id?: string | null;
  contact_id?: string | null;
  status?: string;
  object_text?: string | null;
};
const LIMIT = 8,
  CHUNK = 100,
  digits = (value: string) => value.replace(/\D/g, ""),
  isPhone = (value: string) => /^[\d\s+()\-]+$/.test(value);
const likeLiteral = (value: string) =>
  value.replace(/[\\%_]/g, (character) => `\\${character}`);
const highlight = (value: string, query: string): ReactNode => {
  const term = query.trim();
  if (!term) return value;
  const parts = value.split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"));
  return parts.map((part, index) =>
    part.toLowerCase() === term.toLowerCase() ? <mark key={index}>{part}</mark> : part,
  );
};
async function chunks<T>(
  ids: string[],
  load: (
    ids: string[],
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
) {
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const result = await load(ids.slice(i, i + CHUNK));
    if (result.error) throw new Error(result.error.message);
    rows.push(...(result.data ?? []));
  }
  return rows;
}

export function GlobalSearch() {
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

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem("leadleap-search-recent") ?? "[]");
      if (Array.isArray(stored)) setRecent(stored.filter((value): value is string => typeof value === "string").slice(0, 5));
    } catch {
      setRecent([]);
    }
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
      pattern = likeLiteral(value),
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
        const db = createClient();
        const textSearch = !phone
          ? Promise.all([
              db
                .from("deals")
                .select("id, title, object_text, status")
                .ilike("title", `%${pattern}%`)
                .limit(LIMIT),
              db
                .from("deals")
                .select("id, title, object_text, status")
                .ilike("object_text", `%${pattern}%`)
                .limit(LIMIT),
              db
                .from("tasks")
                .select("id, title, due_at, deal_id")
                .is("done_at", null)
                .ilike("title", `%${pattern}%`)
                .limit(LIMIT),
            ]).then(
              ([dealsByTitle, dealsByObject, tasksByTitle]) => ({
                dealsByTitle,
                dealsByObject,
                tasksByTitle,
                error: null,
              }),
              (cause) => ({
                dealsByTitle: null,
                dealsByObject: null,
                tasksByTitle: null,
                error:
                  cause instanceof Error ? cause : new Error(String(cause)),
              }),
            )
          : null;
        let contactIds: string[] = [];
        if (phone) {
          const [a, b] = await Promise.all([
            db
              .from("contact_phones")
              .select("contact_id")
              .ilike("phone", `%${phoneDigits.slice(-4)}%`)
              .limit(LIMIT),
            db
              .from("imported_contact_phones")
              .select("contact_id")
              .ilike("normalized_phone", `%${phoneDigits}%`)
              .limit(LIMIT),
          ]);
          if (a.error || b.error)
            throw new Error(a.error?.message ?? b.error?.message);
          contactIds = [
            ...new Set(
              [...(a.data ?? []), ...(b.data ?? [])].map(
                (row) => row.contact_id,
              ),
            ),
          ];
        } else {
          const a = await db
            .from("contacts")
            .select("id")
            .ilike("full_name", `%${pattern}%`)
            .limit(LIMIT);
          if (a.error) throw new Error(a.error.message);
          contactIds = (a.data ?? []).map((row) => row.id);
        }
        const contacts = await chunks(contactIds.slice(0, LIMIT), (ids) =>
          db.from("contacts").select("id, full_name").in("id", ids),
        );
        if (current !== requestId.current) return;
        const names = new Map(contacts.map((row) => [row.id, row.full_name]));
        if (contactIds.length) {
          setGroups([
            {
              label: "Контакты",
              icon: Users,
              items: contactIds.slice(0, LIMIT).map((id) => ({
                id,
                kind: "contact",
                title: names.get(id) ?? "Контакт",
                meta: phone ? "Найден по номеру" : undefined,
                href: `/contacts/${id}`,
              })),
            },
          ]);
        }
        if (!phone && textSearch) {
          const direct = await textSearch;
          if (current !== requestId.current) return;
          if (direct.error) {
            setError(`Прямой поиск: ${direct.error.message}`);
          } else {
            const directDeals = [
              ...new Map(
                [
                  ...(direct.dealsByTitle?.data ?? []),
                  ...(direct.dealsByObject?.data ?? []),
                ].map((row) => [row.id, row]),
              ).values(),
            ];
            const directTasks = direct.tasksByTitle?.data ?? [];
            setGroups((previous) => [
              ...previous,
              ...(directDeals.length
                ? [
                    {
                      label: "Сделки",
                      icon: BriefcaseBusiness,
                      items: directDeals
                        .slice(0, LIMIT)
                        .map((row) => ({
                          id: row.id,
                          kind: "deal" as const,
                          title: row.title || row.object_text || "Без названия",
                          meta: row.status,
                          href: `/deals/${row.id}`,
                        })),
                    },
                  ]
                : []),
              ...(directTasks.length
                ? [
                    {
                      label: "Задачи",
                      icon: ListTodo,
                      items: directTasks
                        .slice(0, LIMIT)
                        .map((row) => ({
                          id: row.id,
                          kind: "task" as const,
                          title: row.title,
                          meta: row.due_at
                            ? new Date(row.due_at).toLocaleDateString("ru-RU")
                            : undefined,
                          href: row.deal_id
                            ? `/deals/${row.deal_id}`
                            : "/tasks",
                        })),
                    },
                  ]
                : []),
            ]);
          }
        }
        const directDeals = contactIds.length
          ? await chunks<Row>(contactIds, (ids) =>
              db
                .from("deals")
                .select("id, title, object_text, status, contact_id")
                .in("contact_id", ids)
                .limit(LIMIT),
            )
          : [];
        const links = contactIds.length
          ? await chunks<{ deal_id: string }>(contactIds, (ids) =>
              db
                .from("deal_contacts")
                .select("deal_id")
                .in("contact_id", ids)
                .limit(LIMIT),
            )
          : [];
        const dealIds = [
          ...new Set([
            ...directDeals.map((row) => row.id),
            ...links.map((row) => row.deal_id),
          ]),
        ].slice(0, LIMIT);
        const linkedDeals = dealIds.length
          ? await chunks<Row>(dealIds, (ids) =>
              db
                .from("deals")
                .select("id, title, object_text, status, contact_id")
                .in("id", ids)
                .limit(LIMIT),
            )
          : [];
        let deals = [
          ...new Map(
            [...directDeals, ...linkedDeals].map((row) => [row.id, row]),
          ).values(),
        ];
        let tasks: Row[] = [];
        if (contactIds.length || dealIds.length) {
          const [a, b] = await Promise.all([
            contactIds.length
              ? chunks<Row>(contactIds, (ids) =>
                  db
                    .from("tasks")
                    .select("id, title, due_at, deal_id, contact_id")
                    .is("done_at", null)
                    .in("contact_id", ids)
                    .limit(LIMIT),
                )
              : Promise.resolve([]),
            dealIds.length
              ? chunks<Row>(dealIds, (ids) =>
                  db
                    .from("tasks")
                    .select("id, title, due_at, deal_id, contact_id")
                    .is("done_at", null)
                    .in("deal_id", ids)
                    .limit(LIMIT),
                )
              : Promise.resolve([]),
          ]);
          tasks = [
            ...new Map([...a, ...b].map((row) => [row.id, row])).values(),
          ];
        }
        if (!phone) {
          const direct = await textSearch;
          if (current !== requestId.current) return;
          if (!direct || direct.error) return;
          const { dealsByTitle: a, dealsByObject: b, tasksByTitle: c } = direct;
          if (a?.error || b?.error || c?.error) return;
          deals = [
            ...new Map(
              [...(deals ?? []), ...(a.data ?? []), ...(b.data ?? [])].map(
                (row) => [row.id, row],
              ),
            ).values(),
          ];
          tasks = [
            ...new Map(
              [...tasks, ...(c.data ?? [])].map((row) => [row.id, row]),
            ).values(),
          ];
        }
        const next: { label: string; icon: typeof Users; items: Result[] }[] =
          [];
        if (contactIds.length)
          next.push({
            label: "Контакты",
            icon: Users,
            items: contactIds.slice(0, LIMIT).map((id) => ({
              id,
              kind: "contact",
              title: names.get(id) ?? "Контакт",
              meta: phone ? "Найден по номеру" : undefined,
              href: `/contacts/${id}`,
            })),
          });
        if (deals.length)
          next.push({
            label: "Сделки",
            icon: BriefcaseBusiness,
            items: deals.slice(0, LIMIT).map((row) => ({
              id: row.id,
              kind: "deal",
              title: row.title || row.object_text || "Без названия",
              meta: row.status,
              href: `/deals/${row.id}`,
            })),
          });
        if (tasks.length)
          next.push({
            label: "Задачи",
            icon: ListTodo,
            items: tasks.slice(0, LIMIT).map((row) => ({
              id: row.id,
              kind: "task",
              title: row.title,
              meta: row.due_at
                ? new Date(row.due_at).toLocaleDateString("ru-RU")
                : undefined,
              href: row.deal_id ? `/deals/${row.deal_id}` : "/tasks",
            })),
          });
        if (current === requestId.current) {
          setGroups(next);
          setSelected(0);
        }
      } catch (cause) {
        if (current === requestId.current)
          setError(
            cause instanceof Error
              ? cause.message
              : "Не удалось выполнить поиск",
          );
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
