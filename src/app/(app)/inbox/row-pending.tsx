"use client";

import { useLinkStatus } from "next/link";

// Между кликом и приходом переписки проходит секунда-полторы. Без отметки
// кажется, что нажатие не сработало, и по диалогу бьют второй раз. Строка
// подсвечивается сразу — ответ интерфейса не ждёт сервера.
export function RowPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <span className="inbox-row-pending" aria-label="Открываем переписку" />;
}
