"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Stage, StageKind } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import styles from "./settings.module.css";

type Row = Stage & { counts: { total: number } };
type Editable = Pick<
  Stage,
  | "name"
  | "requires_next_step"
  | "requires_qualification_tag"
  | "requires_qualification"
>;

const kindLabel = (kind: StageKind) =>
  kind === "won" ? "Успешный" : kind === "lost" ? "Неуспешный" : "Открытый";

export function StageTable({
  rows,
  canEdit,
}: {
  rows: Row[];
  canEdit: boolean;
}) {
  const [items, setItems] = useState(rows);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Editable | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{
    stage: Row;
    draft: Editable;
  } | null>(null);
  const pendingRef = useRef(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const saveButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const editButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  function beginEdit(stage: Row) {
    setError(null);
    setEditingId(stage.id);
    setDraft({
      name: stage.name,
      requires_next_step: stage.requires_next_step,
      requires_qualification_tag: stage.requires_qualification_tag,
      requires_qualification: stage.requires_qualification,
    });
  }

  function cancelEdit() {
    if (pendingId) return;
    setEditingId(null);
    setDraft(null);
    setError(null);
  }

  const closeConfirmation = useCallback(() => {
    const stageId = confirming?.stage.id;
    setConfirming(null);
    if (stageId) {
      requestAnimationFrame(() => saveButtonRefs.current[stageId]?.focus());
    }
  }, [confirming]);

  function save(stage: Row) {
    if (!draft || !draft.name.trim()) {
      setError("Введите название этапа.");
      return;
    }
    setConfirming({ stage, draft: { ...draft, name: draft.name.trim() } });
  }

  useEffect(() => {
    if (!confirming) return;
    confirmRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeConfirmation();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeConfirmation, confirming]);

  async function confirmSave() {
    if (!confirming || pendingRef.current) return;
    const { stage, draft: confirmedDraft } = confirming;
    setConfirming(null);

    pendingRef.current = true;
    setPendingId(stage.id);
    setError(null);
    const supabase = createClient();
    const result = await supabase
      .from("stages")
      .update({
        name: confirmedDraft.name,
        requires_next_step: confirmedDraft.requires_next_step,
        requires_qualification_tag: confirmedDraft.requires_qualification_tag,
        requires_qualification: confirmedDraft.requires_qualification,
      })
      .eq("id", stage.id)
      .select(
        "id, name, position, kind, requires_next_step, requires_qualification_tag, requires_qualification, is_active, created_at",
      )
      .single();

    if (result.error) {
      setError(result.error.message);
      setPendingId(null);
      pendingRef.current = false;
      return;
    }

    setItems((current) =>
      current.map((item) =>
        item.id === stage.id ? { ...item, ...(result.data as Stage) } : item,
      ),
    );
    setPendingId(null);
    pendingRef.current = false;
    setEditingId(null);
    setDraft(null);
    requestAnimationFrame(() => editButtonRefs.current[stage.id]?.focus());
  }

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Этап</th>
          <th>Вид</th>
          <th>Следующий шаг</th>
          <th>КВАЛ-тег</th>
          <th>Поля квалификации</th>
          <th className={styles.countHead}>Сделки</th>
          {canEdit && <th className={styles.actionHead}>Действие</th>}
        </tr>
      </thead>
      <tbody>
        {items.map((stage) => {
          const isEditing = editingId === stage.id;
          const isPending = pendingId === stage.id;
          return (
            <tr key={stage.id}>
              <td>
                {isEditing && draft ? (
                  <label className={styles.editField}>
                    <span className={styles.srOnly}>Название этапа</span>
                    <input
                      value={draft.name}
                      onChange={(event) =>
                        setDraft({ ...draft, name: event.target.value })
                      }
                      disabled={isPending}
                    />
                  </label>
                ) : (
                  <>
                    <span
                      className={`${styles.dot} ${stage.kind === "won" ? styles.dotWon : stage.kind === "lost" ? styles.dotLost : ""}`}
                    />
                    {stage.name}
                  </>
                )}
              </td>
              <td>
                <span
                  className={`${styles.kind} ${stage.kind === "won" ? styles.kindWon : stage.kind === "lost" ? styles.kindLost : ""}`}
                >
                  {kindLabel(stage.kind)}
                </span>
              </td>
              <td>
                <Gate
                  value={
                    isEditing && draft
                      ? draft.requires_next_step
                      : stage.requires_next_step
                  }
                  detail={undefined}
                  draft={isEditing ? draft : null}
                  label={`${stage.name}: требовать следующий шаг`}
                  disabled={isPending}
                  onChange={(value) =>
                    draft && setDraft({ ...draft, requires_next_step: value })
                  }
                />
              </td>
              <td>
                <Gate
                  value={
                    isEditing && draft
                      ? draft.requires_qualification_tag
                      : stage.requires_qualification_tag
                  }
                  detail="ручная метка КВАЛ/неквал"
                  draft={isEditing ? draft : null}
                  label={`${stage.name}: требовать КВАЛ-тег`}
                  disabled={isPending}
                  onChange={(value) =>
                    draft &&
                    setDraft({ ...draft, requires_qualification_tag: value })
                  }
                />
              </td>
              <td>
                <Gate
                  value={
                    isEditing && draft
                      ? draft.requires_qualification
                      : stage.requires_qualification
                  }
                  detail="бюджет, оплата и другие поля"
                  draft={isEditing ? draft : null}
                  label={`${stage.name}: требовать заполнение полей квалификации`}
                  disabled={isPending}
                  onChange={(value) =>
                    draft &&
                    setDraft({ ...draft, requires_qualification: value })
                  }
                />
              </td>
              <td className={styles.count}>
                <strong>{stage.counts.total.toLocaleString("ru-RU")}</strong>
              </td>
              {canEdit && (
                <td className={styles.actions}>
                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        className={styles.saveButton}
                        ref={(button) => {
                          saveButtonRefs.current[stage.id] = button;
                        }}
                        onClick={() => save(stage)}
                        disabled={isPending}
                      >
                        {isPending ? "Сохранение…" : "Сохранить"}
                      </button>
                      <button
                        type="button"
                        className={styles.cancelButton}
                        onClick={cancelEdit}
                        disabled={isPending}
                      >
                        Отмена
                      </button>
                      {error && (
                        <span className={styles.inlineError} role="alert">
                          {error}
                        </span>
                      )}
                    </>
                  ) : (
                    <button
                      type="button"
                      className={styles.editButton}
                      ref={(button) => {
                        editButtonRefs.current[stage.id] = button;
                      }}
                      onClick={() => beginEdit(stage)}
                    >
                      Изменить
                    </button>
                  )}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
      {confirming && (
        <tfoot>
          <tr>
            <td colSpan={canEdit ? 7 : 6}>
              <div
                className={styles.confirmDialog}
                role="group"
                aria-labelledby={`confirm-stage-title-${confirming.stage.id}`}
              >
                <div>
                  <strong id={`confirm-stage-title-${confirming.stage.id}`}>
                    Сохранить изменения этапа?
                  </strong>
                  <p>
                    «{confirming.stage.name}» будет обновлён с выбранными
                    правилами.
                  </p>
                </div>
                <div className={styles.confirmActions}>
                  <button
                    ref={confirmRef}
                    type="button"
                    className={styles.saveButton}
                    onClick={confirmSave}
                  >
                    Подтвердить
                  </button>
                  <button
                    type="button"
                    className={styles.cancelButton}
                    onClick={closeConfirmation}
                  >
                    Отмена
                  </button>
                </div>
              </div>
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

function Gate({
  value,
  detail,
  draft,
  label,
  disabled,
  onChange,
}: {
  value: boolean;
  detail?: string;
  draft: Editable | null;
  label: string;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return draft ? (
    <label className={styles.gateEdit}>
      <input
        aria-label={label}
        type="checkbox"
        checked={value}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
      />
      <span>{value ? "Да" : "Нет"}</span>
      {detail && <small>{detail}</small>}
    </label>
  ) : (
    <span className={styles.gate}>
      <span className={value ? styles.on : styles.off}>
        {value ? "Да" : "Нет"}
      </span>
      {detail && <small>{detail}</small>}
    </span>
  );
}
