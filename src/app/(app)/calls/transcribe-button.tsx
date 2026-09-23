"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { dbErrorText } from "@/lib/db-errors";
import styles from "./calls.module.css";

// Кнопка запуска расшифровки: после ответа обновляем панель через refresh,
// итог подтянется из call_transcripts следующим рендером сервера.
export function TranscribeButton({ callId, label }: { callId: string; label: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      className={styles.primaryBtn}
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          const res = await fetch("/api/calls/transcribe", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ callId }),
          });
          const body = (await res.json().catch(() => null)) as {
            error?: string;
            cost?: number | null;
          } | null;
          if (res.status === 409) {
            toast.info("Расшифровка уже идёт — обновите панель через минуту");
          } else if (!res.ok) {
            throw new Error(body?.error ?? "Не удалось расшифровать");
          } else {
            toast.success("Расшифровка готова");
          }
          router.refresh();
        } catch (err) {
          toast.error(dbErrorText(err, "Не удалось расшифровать"));
        } finally {
          setPending(false);
        }
      }}
    >
      {pending ? "Расшифровываем…" : label}
    </button>
  );
}

// Открыли звонок с записью, а текста ещё нет — расшифровка стартует сама.
// Только один запрос на открытие; упавшую не повторяем автоматически,
// там остаётся кнопка «Попробовать снова».
export function AutoTranscribe({ callId }: { callId: string }) {
  const router = useRouter();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const res = await fetch("/api/calls/transcribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ callId }),
        });
        if (!res.ok && res.status !== 409 && res.status !== 422) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          toast.error(dbErrorText(body?.error, "Не удалось расшифровать"));
        }
      } catch (err) {
        toast.error(dbErrorText(err, "Не удалось расшифровать"));
      } finally {
        router.refresh();
      }
    })();
  }, [callId, router]);
  return null;
}
