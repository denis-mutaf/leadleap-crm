"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import styles from "./calls.module.css";

export function CallNoteForm({
  callId,
  initialNote,
  author,
  noteAt,
}: {
  callId: string;
  initialNote: string | null;
  author: string | null;
  noteAt: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialNote ?? "");
  const [saving, setSaving] = useState(false);

  if (!editing && !initialNote)
    return (
      <div className={styles.note}>
        <span className={styles.noteTitle}>Заметка</span>
        <button type="button" className={styles.noteAdd} onClick={() => setEditing(true)}>
          Добавить заметку
        </button>
      </div>
    );

  if (!editing)
    return (
      <div className={styles.note}>
        <span className={styles.noteTitle}>Заметка</span>
        <p className={styles.noteText}>{initialNote}</p>
        <p className={styles.noteMeta}>
          {[author, noteAt ? formatNoteDate(noteAt) : null].filter(Boolean).join(" · ")}
        </p>
        <button type="button" className={styles.noteAdd} onClick={() => setEditing(true)}>
          Редактировать
        </button>
      </div>
    );

  return (
    <form
      className={styles.note}
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
          const res = await fetch("/api/calls/note", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ callId, note: value }),
          });
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          if (!res.ok) throw new Error(body?.error ?? "Не удалось сохранить");
          toast.success("Заметка сохранена");
          setEditing(false);
          router.refresh();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Не удалось сохранить");
        } finally {
          setSaving(false);
        }
      }}
    >
      <label className={styles.noteTitle} htmlFor={`note-${callId}`}>
        Заметка
      </label>
      <textarea
        id={`note-${callId}`}
        className={styles.noteField}
        rows={3}
        maxLength={2000}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Что обсудили, о чём договорились"
      />
      <span className={styles.noteActions}>
        <button type="submit" className={styles.primaryBtn} disabled={saving}>
          {saving ? "Сохраняю…" : "Сохранить"}
        </button>
        <button
          type="button"
          className={styles.noteAdd}
          disabled={saving}
          onClick={() => {
            setValue(initialNote ?? "");
            setEditing(false);
          }}
        >
          Отмена
        </button>
      </span>
    </form>
  );
}

function formatNoteDate(value: string): string {
  const d = new Date(value);
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(d);
}
