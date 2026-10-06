"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Circle, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DateField } from "@/components/crm/date-field";
import { createClient } from "@/lib/supabase/client";
import { tomorrowMorning } from "@/lib/stage-gate";

// Завершение задачи не уводит из списка. Если у сделки после этого не осталось
// ни одной будущей задачи, тут же, в том же окне, предлагаем следующий шаг:
// без него сделка выпадает из работы, а список перерисовывается только при
// закрытии окна — иначе строка уехала бы в «Выполненные» вместе с диалогом.
export function TaskCompletion({
  taskId,
  actorId,
  dealId,
}: {
  taskId: string;
  actorId: string;
  dealId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"result" | "next">("result");
  const [nextTitle, setNextTitle] = useState("");
  const [nextDue, setNextDue] = useState("");
  const [result, setResult] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pendingRef = useRef(false);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, [open]);

  function close() {
    if (pending) return;
    const finished = step === "next";
    setOpen(false);
    setError("");
    setResult("");
    setStep("result");
    requestAnimationFrame(() => triggerRef.current?.focus());
    // Задача уже завершена: после закрытия окна список надо перерисовать.
    if (finished) router.refresh();
  }

  async function planNext() {
    if (pendingRef.current || !dealId) return;
    const title = nextTitle.trim();
    if (!title || !nextDue) {
      setError("Укажите, что сделать, и срок.");
      return;
    }
    const due = new Date(nextDue);
    if (!Number.isFinite(due.getTime()) || due.getTime() <= Date.now()) {
      setError("Срок должен быть в будущем.");
      return;
    }
    setPending(true);
    pendingRef.current = true;
    setError("");
    const created = await createClient()
      .from("tasks")
      .insert({ deal_id: dealId, assignee_id: actorId, title, due_at: due.toISOString(), created_by: actorId })
      .select("id")
      .single();
    setPending(false);
    pendingRef.current = false;
    if (created.error) {
      setError("Не удалось поставить следующий шаг. Попробуйте ещё раз.");
      return;
    }
    toast.success("Следующий шаг поставлен");
    close();
  }

  async function complete() {
    if (pendingRef.current) return;
    const text = result.trim();
    if (!text) {
      setError("Добавьте результат, чтобы закрыть задачу.");
      return;
    }
    setPending(true);
    pendingRef.current = true;
    setError("");
    const supabase = createClient();
    const update = await supabase
      .from("tasks")
      .update({
        done_at: new Date().toISOString(),
        done_by: actorId,
        result_text: text,
      })
      .eq("id", taskId)
      .is("done_at", null)
      .select("id")
      .single();
    if (update.error) {
      setPending(false);
      pendingRef.current = false;
      setError(
        update.error.code === "PGRST116"
          ? "Задача уже завершена или недоступна."
          : "Не удалось завершить задачу. Попробуйте ещё раз.",
      );
      return;
    }
    setPending(false);
    pendingRef.current = false;
    // Есть ли у сделки ещё будущая задача: если нет — предлагаем следующий шаг.
    if (dealId) {
      const left = await supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("deal_id", dealId)
        .is("done_at", null)
        .is("deleted_at", null)
        .gt("due_at", new Date().toISOString());
      if (!left.error && left.count === 0) {
        setNextTitle("");
        setNextDue(tomorrowMorning());
        setStep("next");
        return;
      }
    }
    close();
    router.refresh();
  }

  return (
    <>
      <button
        className="task-check"
        ref={triggerRef}
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
              void (step === "next" ? planNext() : complete());
            }}
          >
            <header>
              <strong>{step === "next" ? "Задача завершена" : "Завершить задачу"}</strong>
              <button
                type="button"
                onClick={close}
                aria-label="Закрыть"
                disabled={pending}
              >
                <X size={16} />
              </button>
            </header>
            {step === "next" ? (
              <>
                <p className="task-completion-lead">
                  У сделки не осталось ни одной будущей задачи. Поставьте следующий шаг — иначе сделка выпадет из работы.
                </p>
                <label htmlFor={`task-next-${taskId}`}>Что сделать дальше</label>
                <input
                  id={`task-next-${taskId}`}
                  value={nextTitle}
                  onChange={(event) => setNextTitle(event.target.value)}
                  placeholder="Например: перезвонить"
                  autoFocus
                  disabled={pending}
                />
                <label>Срок</label>
                <DateField
                  type="datetime-local"
                  disablePast
                  value={nextDue}
                  onChange={setNextDue}
                  aria-label="Срок следующего шага"
                  placeholder="Срок"
                  disabled={pending}
                />
              </>
            ) : (
              <>
                <label htmlFor={`task-result-${taskId}`}>Результат</label>
                <textarea
                  id={`task-result-${taskId}`}
                  value={result}
                  onChange={(event) => setResult(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      void complete();
                    }
                  }}
                  placeholder="Что получилось сделать?"
                  autoFocus
                  disabled={pending}
                />
              </>
            )}
            {error && (
              <p className="task-completion-error" role="alert">
                {error}
              </p>
            )}
            <footer>
              <button type="button" onClick={close} disabled={pending}>
                {step === "next" ? "Не сейчас" : "Отмена"}
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
                    {step === "next" ? "Поставить" : "Завершить"}
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
