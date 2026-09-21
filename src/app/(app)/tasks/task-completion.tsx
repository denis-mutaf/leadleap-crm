"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Circle, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function TaskCompletion({ taskId }: { taskId: string }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, [open]);

  function close() {
    if (pending) return;
    setOpen(false);
    setError("");
    setResult("");
  }

  async function complete() {
    const text = result.trim();
    if (!text) {
      setError("Добавьте результат, чтобы закрыть задачу.");
      return;
    }
    setPending(true);
    setError("");
    const supabase = createClient();
    const update = await supabase
      .from("tasks")
      .update({ done_at: new Date().toISOString(), result_text: text })
      .eq("id", taskId)
      .is("done_at", null)
      .select("id")
      .single();
    if (update.error) {
      setPending(false);
      setError(update.error.message);
      return;
    }
    setPending(false);
    close();
    router.refresh();
  }

  return (
    <>
      <button
        className="task-check"
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Завершить задачу"
      >
        <Circle size={15} />
      </button>
      {open && (
        <dialog
          ref={dialogRef}
          className="task-completion-dialog"
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
        >
          <form
            method="dialog"
            onSubmit={(event) => {
              event.preventDefault();
              void complete();
            }}
          >
            <header>
              <strong>Завершить задачу</strong>
              <button
                type="button"
                onClick={close}
                aria-label="Закрыть"
                disabled={pending}
              >
                <X size={16} />
              </button>
            </header>
            <label htmlFor={`task-result-${taskId}`}>Результат</label>
            <textarea
              id={`task-result-${taskId}`}
              value={result}
              onChange={(event) => setResult(event.target.value)}
              placeholder="Что получилось сделать?"
              autoFocus
              disabled={pending}
            />
            {error && (
              <p className="task-completion-error" role="alert">
                {error}
              </p>
            )}
            <footer>
              <button type="button" onClick={close} disabled={pending}>
                Отмена
              </button>
              <button
                className="task-primary-button"
                type="submit"
                disabled={pending}
              >
                {pending ? (
                  "Сохраняем…"
                ) : (
                  <>
                    <Check size={14} />
                    Завершить
                  </>
                )}
              </button>
            </footer>
          </form>
        </dialog>
      )}
    </>
  );
}
