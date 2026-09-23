"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { dbErrorText } from "@/lib/db-errors";

// Две кнопки, которых не хватало, чтобы диалог не потерялся: «вернуть в
// непрочитанные» (прочитал, ответить сейчас не могу) и «взять себе»
// (показать остальным, что этим занимаются).
export function ThreadActions({
  conversationId,
  unread,
  mine,
}: {
  conversationId: string;
  unread: boolean;
  mine: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/inbox/conversation", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId, ...body }),
    });
    setBusy(false);
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setError(dbErrorText(payload?.error, "Не получилось"));
      return;
    }
    router.refresh();
  }

  return (
    <div className="inbox-thread-actions">
      {error && <span className="inbox-thread-actions-error">{error}</span>}
      {/* Кнопка называет то, чем диалог станет после нажатия: непрочитанный
          помечаем прочитанным, прочитанный возвращаем в непрочитанные. */}
      <button type="button" disabled={busy} onClick={() => patch({ read: unread })}>
        {unread ? "Прочитано" : "В непрочитанные"}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => patch({ assign: mine ? "none" : "me" })}
      >
        {mine ? "Снять с себя" : "Взять себе"}
      </button>
    </div>
  );
}
