"use client";

import { useEffect } from "react";

// При открытии переписки лента встаёт на последнее сообщение. Диалог при этом
// НЕ помечается прочитанным: менеджер мог открыть его мельком, и тихая отметка
// стирала бы «непрочитанное». Прочитанным диалог становится кнопкой
// «Прочитано» (ThreadActions) или ответом клиенту. Страницу не перезагружаем.
export function ThreadOpen({ conversationId }: { conversationId: string }) {
  useEffect(() => {
    const list = document.querySelector<HTMLElement>(".inbox-messages");
    if (list) list.scrollTop = list.scrollHeight;
  }, [conversationId]);

  return null;
}
