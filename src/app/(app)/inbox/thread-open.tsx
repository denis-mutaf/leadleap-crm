"use client";

import { useEffect } from "react";

// Две вещи, которые должны случиться сами при открытии переписки: лента встаёт
// на последнее сообщение, а диалог перестаёт числиться непрочитанным. Страницу
// при этом не перезагружаем — иначе открытие диалога дёргало бы весь экран.
export function ThreadOpen({
  conversationId,
  unread,
}: {
  conversationId: string;
  unread: boolean;
}) {
  useEffect(() => {
    const list = document.querySelector<HTMLElement>(".inbox-messages");
    if (list) list.scrollTop = list.scrollHeight;
  }, [conversationId]);

  useEffect(() => {
    if (!unread) return;
    void fetch("/api/inbox/conversation", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId, read: true }),
    });
  }, [conversationId, unread]);

  return null;
}
