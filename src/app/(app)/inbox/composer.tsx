"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { SendHorizonal } from "lucide-react";
import { dbErrorText } from "@/lib/db-errors";

// Ответ пишется там же, где читается переписка: уводить менеджера в Facebook
// ради одной строки — это и есть та потеря, из-за которой клиенты ждут сутки.
export function Composer({
  conversationId,
  disabledReason,
}: {
  conversationId: string;
  disabledReason: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const field = useRef<HTMLTextAreaElement>(null);

  if (disabledReason)
    return <p className="inbox-composer-blocked">{disabledReason}</p>;

  async function send() {
    const body = value.trim();
    if (!body || pending) return;
    setError(null);
    const response = await fetch("/api/inbox/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId, body }),
    });
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    if (!response.ok) {
      setError(dbErrorText(payload?.error, "Не удалось отправить сообщение"));
      return;
    }
    setValue("");
    startTransition(() => router.refresh());
  }

  return (
    <form
      className="inbox-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      {error && <p className="inbox-composer-error">{error}</p>}
      <div className="inbox-composer-box">
        <textarea
          ref={field}
          value={value}
          rows={2}
          maxLength={2000}
          placeholder="Ответ клиенту. Enter — отправить, Shift+Enter — новая строка"
          aria-label="Текст ответа"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <button type="submit" disabled={!value.trim() || pending}>
          <SendHorizonal size={14} />
          {pending ? "Отправляю" : "Отправить"}
        </button>
      </div>
    </form>
  );
}
