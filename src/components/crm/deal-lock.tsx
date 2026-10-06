"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";

// B-16: сделка открыта в двух вкладках — вторая правка молча затирала первую.
// Каждая запись в deals идёт с условием updated_at = «то, что мы видели». Если
// строка успела измениться, читаем её заново: изменили другое поле — повторяем
// запись с новой отметкой; изменили то же самое — спрашиваем человека.

export type LockMeta = {
  /** Название поля для человека. */
  label: string;
  /** Колонка, значение которой сравниваем с тем, что человек видел. */
  column: string;
  /** Значение колонки, которое человек видел (строкой, пусто = null). */
  was: string | null;
  /** Новое значение для показа в вопросе. */
  next: string | null;
  /** Как показать значение из базы в вопросе. */
  format?: (value: string | null) => string;
};

export type LockResult =
  | { status: "ok" }
  | { status: "error"; error: unknown }
  | { status: "conflict"; current: string | null };

type Conflict = { meta: LockMeta; current: string | null; resolve: (replace: boolean) => void };
type DealLock = { save: (patch: Record<string, unknown>, meta: LockMeta) => Promise<LockResult> };

const Context = createContext<DealLock | null>(null);

export const useDealLock = () => useContext(Context);

const asText = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "object" ? JSON.stringify(value) : String(value);
};

const newer = (a: string, b: string) => Date.parse(a) > Date.parse(b);

export function DealLockProvider({ dealId, updatedAt, children }: { dealId: string; updatedAt: string; children: ReactNode }) {
  const token = useRef(updatedAt);
  // Страница обновилась с сервера (router.refresh) — берём более свежую отметку.
  useEffect(() => {
    if (newer(updatedAt, token.current)) token.current = updatedAt;
  }, [updatedAt]);
  const [conflict, setConflict] = useState<Conflict | null>(null);

  const save = useCallback(async (patch: Record<string, unknown>, meta: LockMeta): Promise<LockResult> => {
    const db = createClient();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await db.from("deals").update(patch).eq("id", dealId).eq("updated_at", token.current).select("updated_at");
      if (result.error) return { status: "error", error: result.error };
      if (result.data?.length) {
        token.current = result.data[0].updated_at as string;
        return { status: "ok" };
      }
      // Ни одна строка не обновилась: отметка устарела (или сделку удалили).
      const fresh = await db.from("deals").select(`updated_at, ${meta.column}`).eq("id", dealId).maybeSingle();
      if (fresh.error) return { status: "error", error: fresh.error };
      if (!fresh.data) return { status: "error", error: { message: "Deal unavailable" } };
      const row = fresh.data as unknown as Record<string, unknown>;
      token.current = row.updated_at as string;
      const current = asText(row[meta.column]);
      if (current === meta.was) continue; // чужая правка другого поля — не конфликт
      const replace = await new Promise<boolean>((resolve) => setConflict({ meta, current, resolve }));
      setConflict(null);
      if (!replace) return { status: "conflict", current };
    }
    return { status: "error", error: { message: "Сделку одновременно меняют, попробуйте ещё раз" } };
  }, [dealId]);

  const show = (value: string | null) => (value === null ? "пусто" : conflict?.meta.format ? conflict.meta.format(value) : value);
  return (
    <Context.Provider value={{ save }}>
      {children}
      {conflict && (
        <div className="gate-scrim motion-veil">
          <div className="gate-dialog motion-dialog" role="alertdialog" aria-modal="true" aria-label="Поле уже изменили">
            <header>
              <div>
                <h2>Поле «{conflict.meta.label}» уже изменили</h2>
                <p>В другой вкладке или другим сотрудником. Сейчас: «{show(conflict.current)}». Ваше значение: «{show(conflict.meta.next)}».</p>
              </div>
            </header>
            <footer>
              <button className="btn" type="button" onClick={() => conflict.resolve(false)}>Оставить текущее</button>
              <button className="gate-primary" type="button" autoFocus onClick={() => conflict.resolve(true)}>Заменить на моё</button>
            </footer>
          </div>
        </div>
      )}
    </Context.Provider>
  );
}
