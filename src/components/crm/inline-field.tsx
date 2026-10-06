"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DateField } from "@/components/crm/date-field";
import { createClient } from "@/lib/supabase/client";
import { dbErrorText } from "@/lib/db-errors";
import { useDealLock } from "@/components/crm/deal-lock";

export type InlineOption = { value: string; label: string };

type Base = {
  /** Подпись слева. Видна всегда, даже когда значения нет. */
  label: string;
  /** Иконка ТИПА атрибута (text/number/select/date/user) слева от подписи. */
  icon?: React.ReactNode;
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
  /** Проверка ввода до записи: текст ошибки или null. Ошибка остаётся под полем. */
  validate?: (value: string) => string | null;
  /** Нижняя граница числа (для type="number"). */
  min?: number;
  /** Колонка числовая, хотя поле — список: в базу уходит число, а не строка. */
  numeric?: boolean;
  /** Подсказки к текстовому вводу (готовые значения справочника), ввод остаётся свободным. */
  suggestions?: string[];
  /** Месяц вместо произвольного текста («2026-12»). */
  month?: boolean;
  /** Другие колонки той же строки, которые пишутся вместе с этой. */
  extra?: Record<string, unknown>;
  /** Что лежит в колонке, если `value` — показ с запасным значением из другой колонки. */
  serverValue?: string | null;
};

type Props = Base &
  (
    | { type?: "text" | "number" | "date" | "textarea"; value: string | null; options?: never }
    | { type: "select"; value: string | null; options: InlineOption[] }
  );

/**
 * Поле карточки, которое правится на месте.
 * Enter — сохранить (в многострочном — Shift+Enter переносит строку),
 * Escape — отменить, потеря фокуса — сохранить.
 * Значение обновляется оптимистично и откатывается при ошибке.
 */
export function InlineField({
  label,
  icon,
  table,
  id,
  column,
  value,
  type = "text",
  options,
  canEdit = true,
  placeholder = "—",
  format,
  validate,
  min,
  numeric = false,
  suggestions,
  month = false,
  extra,
  serverValue,
}: Props) {
  const router = useRouter();
  const lock = useDealLock();
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(value);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);
  // Поле месяца не умеет показать старый текст («скоро»): пока человек ничего не
  // выбрал, потеря фокуса не должна стирать то, что лежит в базе.
  const touched = useRef(false);

  // Поле показывает своё значение сразу после правки, не дожидаясь ответа
  // сервера, поэтому серверное value и локальное current живут отдельно.
  // Синхронизация через useEffect давала лишний проход рендера на каждое
  // обновление страницы — сверка делается прямо в рендере, как советует React.
  const [syncedValue, setSyncedValue] = useState(value);
  if (syncedValue !== value) {
    setSyncedValue(value);
    setCurrent(value);
  }
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function open() {
    if (!canEdit || saving) return;
    setDraft(current ?? "");
    setError(null);
    touched.current = false;
    setEditing(true);
  }

  function cancel() {
    setError(null);
    setEditing(false);
  }

  async function commit(next: string) {
    if (month && !touched.current) {
      cancel();
      return;
    }
    const cleaned = next.trim();
    const previous = current;
    const stored = cleaned === "" ? null : cleaned;
    if (stored === previous) {
      setError(null);
      setEditing(false);
      return;
    }
    const problem = stored === null ? null : (validate?.(stored) ?? null);
    if (problem) {
      // Ввод остаётся открытым: человек видит, что не так, и правит на месте.
      setError(problem);
      return;
    }
    setError(null);
    setEditing(false);
    setCurrent(stored);
    setSaving(true);
    const columnValue = (type === "number" || numeric) && stored ? Number(stored) : stored;
    const patch = { [column]: columnValue, ...extra };
    let failure: unknown = null;
    if (lock && table === "deals") {
      const was = previous === value && serverValue !== undefined ? serverValue : previous;
      const result = await lock.save(patch, { label, column, was, next: stored, format: (value) => (type === "select" ? (options?.find((option) => option.value === value)?.label ?? value ?? "") : format ? format(value) : (value ?? "")) });
      if (result.status === "conflict") {
        setSaving(false);
        setCurrent(result.current);
        router.refresh();
        return;
      }
      if (result.status === "error") failure = result.error;
    } else {
      failure = (await createClient().from(table).update(patch).eq("id", id)).error;
    }
    setSaving(false);
    if (failure) {
      setCurrent(previous);
      toast.error(dbErrorText(failure, `${label} не сохранилось. Попробуйте ещё раз.`));
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
      <span>{icon}{label}</span>
      {editing ? (
        type === "select" ? (
          <select
            ref={inputRef as React.RefObject<HTMLSelectElement>}
            className="field-select"
            value={draft}
            onChange={(event) => commit(event.target.value)}
            onBlur={cancel}
            onKeyDown={(event) => event.key === "Escape" && cancel()}
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
              if (event.key === "Escape") cancel();
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                commit(draft);
              }
            }}
          />
        ) : type === "date" ? (
          <DateField
            className="field-input"
            value={draft}
            onChange={commit}
            onClose={cancel}
            defaultOpen
            clearable
            aria-label={label}
            placeholder={placeholder}
          />
        ) : (
          <>
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              className="field-input"
              type={month ? "month" : type === "number" ? "number" : "text"}
              min={type === "number" ? min : undefined}
              list={suggestions ? `${id}-${column}-options` : undefined}
              value={draft}
              aria-invalid={error ? true : undefined}
              onChange={(event) => {
                setDraft(event.target.value);
                setError(null);
                touched.current = true;
                // Выбор месяца из календаря — законченное действие, ждать blur незачем.
                if (month && /^\d{4}-\d{2}$/.test(event.target.value)) void commit(event.target.value);
              }}
              onBlur={(event) => commit(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") cancel();
                if (event.key === "Enter") commit(draft);
              }}
            />
            {suggestions && (
              <datalist id={`${id}-${column}-options`}>
                {suggestions.map((item) => <option key={item} value={item} />)}
              </datalist>
            )}
          </>
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
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}

/** Поле только для чтения — та же сетка, но обычный текст без вида кнопки. */
export function ReadField({
  label,
  icon,
  value,
  placeholder = "—",
}: {
  label: string;
  icon?: React.ReactNode;
  value: string | number | null | undefined;
  placeholder?: string;
}) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="field-row">
      <span>{icon}{label}</span>
      <span className={`field-static ${empty ? "is-empty" : ""}`}>
        {empty ? placeholder : String(value)}
      </span>
    </div>
  );
}
