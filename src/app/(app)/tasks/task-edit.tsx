"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { DateField } from "@/components/crm/date-field";

// Правка открытой задачи: название, срок и ответственный. Срок правится
// <DateField type="datetime-local"> — значение то же, что у нативного поля
// ("YYYY-MM-DDTHH:mm"), в базу уходит ISO как при создании задачи.
function toLocalInput(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Chisinau",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function TaskEdit({
  taskId,
  initialTitle,
  initialDueAt,
  initialAssigneeId,
  people,
}: {
  taskId: string;
  initialTitle: string;
  initialDueAt: string;
  initialAssigneeId: string | null;
  people: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [due, setDue] = useState(() => toLocalInput(initialDueAt));
  const [assigneeId, setAssigneeId] = useState(initialAssigneeId ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    dialog?.showModal();
    // showModal ставит фокус на первую кнопку (крестик) — ведём его в поле названия.
    dialog?.querySelector<HTMLInputElement>("input")?.focus();
    return () => dialog?.close();
  }, [open ]);

  function reopen() {
    setTitle(initialTitle);
    setDue(toLocalInput(initialDueAt));
    setAssigneeId(initialAssigneeId ?? "");
    setError("");
    setOpen(true);
  }

  function close() {
    if (pending) return;
    setOpen(false);
    setError("");
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  async function save() {
    const name = title.trim();
    if (!name) {
      setError("Название задачи не может быть пустым.");
      return;
    }
    if (!due) {
      setError("Укажите срок задачи.");
      return;
    }
    const dueDate = new Date(due);
    if (Number.isNaN(dueDate.getTime())) {
      setError("Срок указан неверно.");
      return;
    }
    setPending(true);
    setError("");
    const supabase = createClient();
    const update = await supabase
      .from("tasks")
      .update({
        title: name,
        due_at: dueDate.toISOString(),
        assignee_id: assigneeId || null,
      })
      .eq("id", taskId)
      .is("done_at", null)
      .select("id")
      .single();
    setPending(false);
    if (update.error) {
      if (update.error.code === "PGRST116") {
        toast.error("Задача уже завершена или недоступна.");
        close();
        router.refresh();
        return;
      }
      setError("Не получилось сохранить. Попробуйте ещё раз.");
      return;
    }
    toast.success("Задача обновлена");
    close();
    router.refresh();
  }

  return (
    <>
      <button
        className="task-check task-edit-trigger"
        ref={triggerRef}
        type="button"
        onClick={reopen}
        aria-label="Редактировать задачу"
        title="Редактировать задачу"
      >
        <Pencil size={15} />
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
              void save();
            }}
          >
            <header>
              <strong>Редактировать задачу</strong>
              <button
                type="button"
                onClick={close}
                aria-label="Закрыть"
                disabled={pending}
              >
                <X size={16} />
              </button>
            </header>
            <label htmlFor={`task-title-${taskId}`}>Название</label>
            <input
              id={`task-title-${taskId}`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Что нужно сделать?"
              autoFocus
              disabled={pending}
            />
            <label>Срок</label>
            <DateField
              type="datetime-local"
              value={due}
              onChange={setDue}
              aria-label="Срок задачи"
              placeholder="Срок"
              disabled={pending}
            />
            <label htmlFor={`task-assignee-${taskId}`}>
              Ответственный
            </label>
            <select
              id={`task-assignee-${taskId}`}
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.target.value)}
              disabled={pending}
            >
              <option value="">Общий котёл</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
            {error && (
              <p className="task-completion-error" role="alert">
                {error}
              </p>
            )}
            <footer>
              <button className="btn-ghost" type="button" onClick={close} disabled={pending}>
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
                    Сохранить
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
