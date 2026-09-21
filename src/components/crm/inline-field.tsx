"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

export type InlineOption = { value: string; label: string };

type Base = {
  /** Подпись слева. Видна всегда, даже когда значения нет. */
  label: string;
  /** Таблица и строка, куда пишем. */
  table: string;
  id: string;
  column: string;
  /** Право на правку. Без него поле читается, но не редактируется. */
  canEdit?: boolean;
  /** Что показать вместо пустоты. По контракту — тире. */
  placeholder?: string;
  /** Как показать значение человеку (валюта, дата, словарь). */
  format?: (value: string | null) => string;
};

type Props = Base &
  (
    | { type?: "text" | "number" | "date" | "textarea"; value: string | null; options?: never }
    | { type: "select"; value: string | null; options: InlineOption[] }
  );

/**
 * Поле карточки, которое правится на месте.
 * Enter — сохранить, Escape — отменить, потеря фокуса — сохранить.
 * Значение обновляется оптимистично и откатывается при ошибке.
 */
export function InlineField({
  label,
  table,
  id,
  column,
  value,
  type = "text",
  options,
  canEdit = true,
  placeholder = "—",
  format,
}: Props) {
  const router = useRouter();
  const [current, setCurrent] = useState<string | null>(value);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);

  useEffect(() => setCurrent(value), [value]);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function open() {
    if (!canEdit || saving) return;
    setDraft(current ?? "");
    setEditing(true);
  }

  async function commit(next: string) {
    const cleaned = next.trim();
    const previous = current;
    const stored = cleaned === "" ? null : cleaned;
    setEditing(false);
    if (stored === previous) return;
    setCurrent(stored);
    setSaving(true);
    const result = await createClient()
      .from(table)
      .update({ [column]: type === "number" && stored ? Number(stored) : stored })
      .eq("id", id);
    setSaving(false);
    if (result.error) {
      setCurrent(previous);
      toast.error(`Не сохранилось: ${result.error.message}`);
      return;
    }
    toast.success(`${label} — сохранено`);
    router.refresh();
  }

  const shown =
    current === null || current === ""
      ? null
      : type === "select"
        ? (options?.find((option) => option.value === current)?.label ?? current)
        : format
          ? format(current)
          : current;

  return (
    <div className={`field-row ${saving ? "field-saving" : ""}`}>
      <span>{label}</span>
      {editing ? (
        type === "select" ? (
          <select
            ref={inputRef as React.RefObject<HTMLSelectElement>}
            className="field-select"
            value={draft}
            onChange={(event) => commit(event.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(event) => event.key === "Escape" && setEditing(false)}
          >
            <option value="">— не выбрано —</option>
            {options?.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : type === "textarea" ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            className="field-textarea"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={(event) => commit(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setEditing(false);
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey))
                commit(draft);
            }}
          />
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            className="field-input"
            type={type === "number" ? "number" : type === "date" ? "date" : "text"}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={(event) => commit(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setEditing(false);
              if (event.key === "Enter") commit(draft);
            }}
          />
        )
      ) : (
        <button
          type="button"
          className={`field-value ${shown === null ? "is-empty" : ""}`}
          onClick={open}
          disabled={!canEdit}
          title={canEdit ? "Нажмите, чтобы изменить" : undefined}
        >
          {shown ?? placeholder}
        </button>
      )}
    </div>
  );
}

/** Поле только для чтения — та же сетка, чтобы карточка не расползалась. */
export function ReadField({
  label,
  value,
  placeholder = "—",
}: {
  label: string;
  value: string | number | null | undefined;
  placeholder?: string;
}) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="field-row">
      <span>{label}</span>
      <span className={`field-value ${empty ? "is-empty" : ""}`} style={{ cursor: "default" }}>
        {empty ? placeholder : String(value)}
      </span>
    </div>
  );
}
