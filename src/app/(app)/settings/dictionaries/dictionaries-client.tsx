"use client";

import { useEffect, useRef, useState } from "react";
import { Ellipsis, Info, Plus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { UserRole } from "@/lib/types";
import styles from "./dictionaries.module.css";

type Row = {
  id: string;
  name: string;
  usage: number;
  is_active?: boolean;
  code?: string;
  merged_into?: string | null;
};
export type DictionaryData = { key: string; label: string; rows: Row[] };
const labels: Record<string, string> = {
  tags: "Метка",
  sources: "Источник",
  task_types: "Тип задачи",
  lost_reasons: "Причина отказа",
  projects: "Площадка",
};
const relationText: Record<string, string> = {
  tags: "метка",
  sources: "источник",
  task_types: "тип задачи",
  lost_reasons: "причина отказа",
  projects: "площадка",
};

export function DictionariesClient({
  initialData,
  initialError = "",
  role,
}: {
  initialData: DictionaryData[];
  initialError?: string;
  role: UserRole;
}) {
  const [data, setData] = useState(initialData),
    [active, setActive] = useState("tags"),
    [menu, setMenu] = useState<string | null>(null),
    [editing, setEditing] = useState<Row | null>(null),
    [merge, setMerge] = useState<Row | null>(null),
    [adding, setAdding] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const canEdit = role === "admin" || (role === "head" && active === "tags"),
    dictionary = data.find((x) => x.key === active) ?? {
      key: active,
      label: "",
      rows: [],
    },
    isSystemTag = (row: Row) =>
      active === "tags" && (row.name === "КВАЛ" || row.name === "неквал");
  const refresh = async () => {
    const db = createClient(),
      selection =
        active === "tags"
          ? "id,name,is_active,merged_into"
          : active === "lost_reasons"
            ? "id,name,is_active,position"
            : `id,name,is_active,code`;
    const result = await db.from(active).select(selection).order("name");
    if (result.error) throw result.error;
    const rows = result.data ?? [];
    const counts = await db.rpc("dictionary_usage_counts");
    if (counts.error) throw counts.error;
    const usage = new Map<string, number>();
    for (const item of counts.data ?? []) {
      const key = `${item.dictionary_key}:${item.value_id}`;
      usage.set(key, (usage.get(key) ?? 0) + Number(item.usage));
    }
    const updated = rows.map((row) => ({
      ...row,
      usage: usage.get(`${active}:${row.id}`) ?? 0,
    }));
    setData((all) =>
      all.map((item) =>
        item.key === active ? { ...item, rows: updated } : item,
      ),
    );
  };
  const busyRef = useRef(false);
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось сохранить изменения.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const save = (row: Row, name: string) =>
    run(async () => {
      const value = name.trim();
      if (value.length < 2 || value.length > 80)
        throw new Error("Название должно быть от 2 до 80 символов.");
      const result = await createClient()
        .from(active)
        .update({ name: value })
        .eq("id", row.id)
        .select("id,name")
        .single();
      if (result.error) throw result.error;
      await refresh();
      setEditing(null);
    });
  const add = (name: string) =>
    run(async () => {
      const value = name.trim();
      if (value.length < 2 || value.length > 80)
        throw new Error("Название должно быть от 2 до 80 символов.");
      const payload: Record<string, string> = { name: value };
      if (["sources", "task_types", "projects"].includes(active))
        payload.code = value.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, "-");
      const result = await createClient()
        .from(active)
        .insert(payload)
        .select("id")
        .single();
      if (result.error) throw result.error;
      await refresh();
      setAdding(false);
    });
  const hide = (row: Row) =>
    run(async () => {
      const result = await createClient()
        .from(active)
        .update({ is_active: false })
        .eq("id", row.id)
        .select("id")
        .single();
      if (result.error) throw result.error;
      await refresh();
      setMenu(null);
    });
  const restore = (row: Row) =>
    run(async () => {
      const result = await createClient()
        .from(active)
        .update({ is_active: true })
        .eq("id", row.id)
        .select("id")
        .single();
      if (result.error) throw result.error;
      await refresh();
      setMenu(null);
    });
  const doMerge = (target: Row) =>
    run(async () => {
      if (!merge || merge.id === target.id) return;
      const result = await createClient().rpc("merge_crm_tag", {
        p_source_id: merge.id,
        p_target_id: target.id,
      });
      if (result.error) throw result.error;
      await refresh();
      setMerge(null);
    });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(null);
        setEditing(null);
        setMerge(null);
        setAdding(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (initialError) {
    return (
      <div className={styles.page} role="alert">
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Настройки</p>
            <h1>Справочники</h1>
            <p className={styles.subtitle}>{initialError}</p>
          </div>
        </header>
        <section className={styles.card}>
          <div className={styles.unavailable}>
            <strong>Справочники временно недоступны</strong>
            <button
              className={styles.primary}
              onClick={() => window.location.reload()}
            >
              Повторить
            </button>
          </div>
        </section>
      </div>
    );
  }
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Настройки</p>
          <h1>Справочники</h1>
          <p className={styles.subtitle}>
            Значения из справочников подставляются в карточку. Свободного ввода
            нет.
          </p>
        </div>
        {canEdit && (
          <button
            className={styles.primary}
            onClick={() => setAdding(true)}
            disabled={busy}
          >
            <Plus size={15} /> {labels[active]}
          </button>
        )}
      </header>
      <nav className={styles.tabs} aria-label="Справочники">
        {data.map((item) => (
          <button
            className={item.key === active ? styles.selected : ""}
            onClick={() => {
              setActive(item.key);
              setMenu(null);
            }}
            key={item.key}
          >
            {item.label}
          </button>
        ))}
        <span className={styles.disabledTab}>
          Способы оплаты <small>enum</small>
        </span>
      </nav>
      <section className={styles.card}>
        <div className={styles.tableHead}>
          <span>Значение</span>
          <span>Назначение</span>
          <span>Использований</span>
          <span>Состояние</span>
          <span />
        </div>
        {dictionary.rows.map((row) => (
          <div
            className={`${styles.row} ${row.is_active === false ? styles.inactive : ""}`}
            key={row.id}
          >
            <strong>{row.name}</strong>
            <span className={styles.muted}>{relationText[active]}</span>
            <span>{row.usage}</span>
            <span>{row.is_active === false ? "Скрыто" : "Активно"}</span>
            <span className={styles.actions}>
              {canEdit && isSystemTag(row) ? (
                <span className={styles.muted}>Системная метка воронки</span>
              ) : canEdit ? (
                <>
                  <button
                    className={styles.iconButton}
                    aria-label={`Действия: ${row.name}`}
                    onClick={() => setMenu(menu === row.id ? null : row.id)}
                  >
                    <Ellipsis size={17} />
                  </button>
                  {menu === row.id && (
                    <div className={styles.menu}>
                      <button
                        onClick={() => {
                          setEditing(row);
                          setMenu(null);
                        }}
                      >
                        Переименовать
                      </button>
                      {active === "tags" && row.is_active !== false && (
                        <button
                          onClick={() => {
                            setMerge(row);
                            setMenu(null);
                          }}
                        >
                          Слить с другой
                        </button>
                      )}
                      {row.is_active !== false ? (
                        <button onClick={() => hide(row)}>Скрыть</button>
                      ) : (
                        <button onClick={() => restore(row)}>
                          Восстановить
                        </button>
                      )}
                    </div>
                  )}
                </>
              ) : null}
            </span>
          </div>
        ))}
      </section>
      <aside className={styles.note}>
        <Info size={16} />
        <span>
          Месяц обращения и кампанию система считает сама из даты и меток
          рекламы — эти метки можно не вести руками.
        </span>
      </aside>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {initialError && (
        <p className={styles.error} role="alert">
          {initialError}
        </p>
      )}
      {adding && (
        <FormModal
          title={`Добавить: ${labels[active]}`}
          close={() => setAdding(false)}
          submit={add}
          busy={busy}
        />
      )}
      {editing && (
        <FormModal
          title={`Переименовать «${editing.name}»`}
          close={() => setEditing(null)}
          submit={(name) => save(editing, name)}
          initial={editing.name}
          busy={busy}
        />
      )}
      {merge && (
        <Modal title={`Слить «${merge.name}» с`} close={() => setMerge(null)}>
          <p className={styles.warning}>
            Все {merge.usage} использований получат выбранную метку. Старая
            исчезнет, историю это не меняет. Действие необратимо.
          </p>
          <div className={styles.targets}>
            {dictionary.rows
              .filter((row) => row.id !== merge.id && row.is_active !== false)
              .map((row) => (
                <button
                  key={row.id}
                  onClick={() => doMerge(row)}
                  disabled={busy}
                >
                  {row.name}
                  <small>{row.usage}</small>
                </button>
              ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
function Modal({
  title,
  close,
  children,
  initialFocusRef,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          "button, input, [href], [tabindex]:not([tabindex='-1'])",
        ),
      );
    (initialFocusRef?.current ?? focusable()[0])?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (
        (!event.shiftKey && document.activeElement === last) ||
        (event.shiftKey && document.activeElement === first)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    dialog.addEventListener("keydown", onKeyDown);
    return () => dialog.removeEventListener("keydown", onKeyDown);
  }, [initialFocusRef]);
  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <div
        className={styles.modal}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <button className={styles.close} onClick={close} aria-label="Закрыть">
          <X size={17} />
        </button>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
function FormModal({
  title,
  close,
  submit,
  initial = "",
  busy,
}: {
  title: string;
  close: () => void;
  submit: (name: string) => void;
  initial?: string;
  busy: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <Modal title={title} close={close} initialFocusRef={inputRef}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(new FormData(event.currentTarget).get("name") as string);
        }}
      >
        <input ref={inputRef} name="name" defaultValue={initial} />
        <button className={styles.primary} disabled={busy}>
          Сохранить
        </button>
      </form>
    </Modal>
  );
}
