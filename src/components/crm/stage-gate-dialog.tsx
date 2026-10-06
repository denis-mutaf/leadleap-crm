"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { DateField } from "@/components/crm/date-field";
import { UNQUALIFIED_BLOCK_TEXT, unqualifiedBlocks, type GateForm, type GatePlan, type GateStage } from "@/lib/stage-gate";

type Option = { id: string; name: string };

// Модалка смены этапа — одна на канбан и карточку сделки: что просить у
// менеджера решает план гейтов, а не место, откуда он начал переход.
export function StageGateDialog({ plan, target, stages, form, setForm, lostReasons, taskTypes, assignees, pending, error, onCancel, onSubmit, onOpenDeal, openLabel = "Открыть сделку" }: {
  plan: GatePlan;
  target: GateStage;
  stages: readonly GateStage[];
  form: GateForm;
  setForm: Dispatch<SetStateAction<GateForm>>;
  lostReasons: Option[];
  taskTypes: Option[];
  assignees: Option[];
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: () => void;
  /** Есть — предлагаем открыть карточку, чтобы заполнить пустые поля. */
  onOpenDeal?: () => void;
  openLabel?: string;
}) {
  const unqualifiedPicked = plan.needsQualification && form.qualification === "неквал" && unqualifiedBlocks(target, stages);
  const blocked = plan.blocked ?? (unqualifiedPicked ? UNQUALIFIED_BLOCK_TEXT : null);
  const fieldsBlock = plan.missingFields.length > 0;
  const stuck = Boolean(blocked) || fieldsBlock;
  const canSubmit = !fieldsBlock && !plan.blocked && !pending && !unqualifiedPicked;
  // На кнопке подсказка ↵, значит Enter и есть основное действие. Исключения —
  // элементы, у которых Enter свой: кнопки и ссылки (нажмутся сами), список,
  // многострочное поле.
  const submitRef = useRef({ canSubmit, onSubmit });
  useEffect(() => { submitRef.current = { canSubmit, onSubmit }; });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.defaultPrevented) return;
      if ((event.target as HTMLElement | null)?.closest("textarea, select, button, a, [role='listbox'], [role='option']")) return;
      if (!submitRef.current.canSubmit) return;
      event.preventDefault();
      submitRef.current.onSubmit();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  const title = plan.lost ? "Закрыть сделку как отказ" : fieldsBlock ? "Не заполнена квалификация" : blocked ? "Переход закрыт" : plan.needsQualification ? "Клиент квалифицирован?" : "Нужен следующий шаг";
  const lead = plan.lost
    ? "Укажите причину — история сделки сохранится."
    : fieldsBlock ? `Сделка не перейдёт в «${target.name}», пока не заполнены поля квалификации.`
    : blocked ? blocked
    : plan.needsQualification ? "Отмечайте после разговора — это видно всему отделу."
    : `Сделка не перейдёт в «${target.name}», пока не назначен следующий шаг.`;
  return <div className="gate-scrim motion-veil"><div className="gate-dialog motion-dialog" role="dialog" aria-modal="true">
    <header><div><h2>{title}</h2><p>{lead}</p></div><button className="gate-close" type="button" onClick={onCancel} aria-label="Закрыть"><X size={16} /></button></header>
    {plan.lost ? <>
      <label>Причина<select value={form.reasonId} onChange={(event) => setForm({ ...form, reasonId: event.target.value })}><option value="">Выберите причину</option>{lostReasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.name}</option>)}</select></label>
      <label>Комментарий<textarea value={form.comment} onChange={(event) => setForm({ ...form, comment: event.target.value })} /></label>
      {plan.openTasks > 0 && <label className="gate-check"><input type="checkbox" checked={form.closeTasks} onChange={(event) => setForm({ ...form, closeTasks: event.target.checked })} />Закрыть открытые задачи сделки ({plan.openTasks})</label>}
    </> : <>
      {fieldsBlock && <div className="gate-missing"><span>Пустые поля:</span><ul>{plan.missingFields.map((field) => <li key={field}>{field}</li>)}</ul></div>}
      {plan.needsQualification && !fieldsBlock && !plan.blocked && <div className="qual-options"><button type="button" className={form.qualification === "КВАЛ" ? "selected" : ""} onClick={() => setForm({ ...form, qualification: "КВАЛ" })}>Квалифицирован</button><button type="button" className={form.qualification === "неквал" ? "selected" : ""} onClick={() => setForm({ ...form, qualification: "неквал" })}>Не квалифицирован</button></div>}
      {unqualifiedPicked && !plan.blocked && <p className="gate-error" role="alert">{UNQUALIFIED_BLOCK_TEXT}</p>}
      {plan.needsTask && !stuck && <>
        <label>Тип задачи<select value={form.taskTypeId} onChange={(event) => setForm({ ...form, taskTypeId: event.target.value })}>{taskTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
        <label>Что сделать<input value={form.taskTitle} onChange={(event) => setForm({ ...form, taskTitle: event.target.value })} /></label>
        <label>Дата и время<DateField type="datetime-local" disablePast value={form.taskDueAt} onChange={(taskDueAt) => setForm({ ...form, taskDueAt })} aria-label="Дата и время задачи" placeholder="Когда" /></label>
        <label>Исполнитель<select value={form.taskAssigneeId} onChange={(event) => setForm({ ...form, taskAssigneeId: event.target.value })}>{assignees.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
      </>}
    </>}
    {error && <p className="gate-error" role="alert">{error}</p>}
    <footer>
      <button className="btn" type="button" onClick={onCancel} disabled={pending}>Отмена <kbd>Esc</kbd></button>
      {fieldsBlock && onOpenDeal && <button className="gate-primary" type="button" onClick={onOpenDeal}>{openLabel}</button>}
      {!fieldsBlock && !plan.blocked && <button className="gate-primary" type="button" onClick={onSubmit} disabled={!canSubmit}>{plan.lost ? "Закрыть как отказ" : plan.needsTask ? "Поставить задачу и перевести" : "Перевести"} <kbd>↵</kbd></button>}
    </footer>
  </div></div>;
}
