"use client";

import { CalendarDays, Check, CheckSquare, Clock3, FileText, Hash, History, List, MessageCircle, Pencil, Phone, Plus, Trash2, Type, User, X } from "lucide-react";
import Link from "next/link";
import { monthlyAmount, shortAmount } from "@/lib/amo-amount";
import { FormEvent, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { InlineField, ReadField } from "@/components/crm/inline-field";
import { buildAttribution, canonicalFieldKey, isAttributionField, normalizeOptions, type Attribution, type DealFieldDefinition, type DealFieldValue, valueToString } from "@/lib/deal-fields";
import { createClient } from "@/lib/supabase/client";
import { DateField } from "@/components/crm/date-field";
import { StageIndicator } from "@/components/crm/stage-indicator";
import { StageGateDialog } from "@/components/crm/stage-gate-dialog";
import { DealLockProvider, useDealLock } from "@/components/crm/deal-lock";
import { amountError, budgetError, DOWN_PAYMENT_PRESETS, formatMonth, monthError, MONTHLY_PAYMENT_PRESETS, RESIDENCY_OPTIONS, ROOM_OPTIONS, sizeError } from "@/lib/deal-input";
import { changeText, describeChanges } from "@/lib/deal-changes";
import { dbErrorText } from "@/lib/db-errors";
import { ProjectField, TagsField } from "./card-parts";
import cardStyles from "./card-parts.module.css";
import { closeOpenTasks, emptyGateForm, loadGateSnapshot, planGate, targetHasGates, tomorrowMorning, transitionDeal, transitionErrorText, unqualifiedBlocks, type GateForm, type GatePlan } from "@/lib/stage-gate";
import styles from "./record.module.css";

type Person = { id: string; full_name: string; role?: string };
type Task = { id: string; deal_id: string; assignee_id: string | null; title: string; due_at: string; done_at: string | null; done_by: string | null; created_at: string; is_auto: boolean; result_text: string | null };
type Note = { id: string; deal_id: string; author_id: string | null; body: string; created_at: string; edited_at: string | null; amo_id: number | null; amo_note_type: string | null };
type Call = { id: string; external_id: string | null; direction: "in" | "out"; status: string | null; from_phone: string | null; to_phone: string | null; user_id: string | null; started_at: string; answered_at: string | null; duration_sec: number | null; recording_url: string | null };
type Transition = { id: string; from_stage_id: string | null; to_stage_id: string; from_status: string | null; to_status: string; changed_by: string | null; changed_at: string };
type ChangeEvent = { id: string; at: string; actor_id: string | null; changes: Record<string, unknown> };
type FeedEntry =
  | { type: "calls"; date: string; item: Call }
  | { type: "notes"; date: string; item: Note }
  | { type: "tasks"; date: string; item: Task }
  | { type: "stages"; date: string; item: Transition }
  | { type: "changes"; date: string; item: ChangeEvent };
type DeleteTarget = { entity: "notes" | "tasks"; id: string; label: string };
type Stage = { id: string; name: string; kind: "open" | "won" | "lost"; position: number; requires_next_step?: boolean; requires_qualification_tag?: boolean; requires_qualification?: boolean };
type Project = { id: string; code: string; name: string };
type TagOption = { id: string; name: string };
type Source = { id: string; name: string };
type LostReason = { id: string; name: string };
type TaskType = { id: string; name: string };

export type DealRecordData = {
  deal: Record<string, unknown> & { id: string; contact_id: string; owner_id: string | null; stage_id: string; status: string; title: string | null; object_text: string | null; budget: number | null; budget_currency: string; amount?: number | null; created_at: string; updated_at: string; source_id: string | null; utm?: Record<string, unknown>; amo_custom_fields?: unknown; construction_stage?: string | null; payment: string | null; horizon: string | null; residency: string | null; rooms: number | null; purpose: string | null; down_payment?: number | null; monthly_payment?: number | null; down_payment_text?: string | null; monthly_payment_text?: string | null; purchase_timing_text?: string | null; residency_detail?: string | null; desired_area_text?: string | null; desired_floor_text?: string | null; wishes?: string | null };
  contact: { id: string; full_name: string; created_at: string; updated_at?: string | null } | null;
  phones: { id: string; phone: string; is_primary: boolean }[];
  channels: { id: string; channel: string; handle: string | null; external_id: string }[];
  owner: Person | null; stage: { id: string; name: string; kind: string } | null; projects: Project[]; tags: TagOption[]; source: Source | null;
  tasks: Task[]; notes: Note[]; calls: Call[]; transitions: Transition[]; people: Person[]; transitionStages: { id: string; name: string }[]; changes: { events: ChangeEvent[]; names: Record<string, string> }; currentUser: Person;
  feedCounts: { tasks: number; notes: number; calls: number; stages: number }; fieldDefs: DealFieldDefinition[]; fieldValues: DealFieldValue[]; allStages: Stage[]; allProjects: Project[]; allTags: TagOption[]; allOwners: Person[]; allSources: Source[]; allLostReasons: LostReason[]; taskTypes: TaskType[]; lostReasonName: string | null;
};

const labels: Record<string, string> = { open: "В работе", postponed: "Отложена", won: "Выиграна", lost: "Проиграна", cash: "Наличные", mortgage: "Ипотека", installment: "Рассрочка", local: "Местный", diaspora: "Диаспора", living: "Для жизни", investment: "Инвестиция" };
const attributionLabels: Record<keyof Attribution, string> = { utm_source: "utm_source", utm_medium: "utm_medium", utm_campaign: "utm_campaign", utm_content: "utm_content", utm_term: "utm_term", UTM_ID: "UTM_ID", fbclid: "fbclid", FORMNAME: "Форма", TRANID: "TRANID", _ym_uid: "_ym_uid" };
const fmtMoney = (value: number | null | undefined, currency = "EUR") => value == null ? null : `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value)} ${currency}`;
const fmtDate = (value: string) => new Date(value).toLocaleString("ru-RU", { timeZone: "Europe/Chisinau", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
// «Следующий шаг: Позвонить» без срока бесполезен: весь смысл шага в том, когда
// он наступит. Сегодня и завтра называются словом, дальше — датой.
const fmtDue = (value: string) => {
  const due = new Date(value);
  const time = due.toLocaleString("ru-RU", { timeZone: "Europe/Chisinau", hour: "2-digit", minute: "2-digit" });
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const shift = Math.round((day(due) - day(new Date())) / 86400000);
  if (shift === 0) return `сегодня ${time}`;
  if (shift === 1) return `завтра ${time}`;
  if (shift === -1) return `вчера ${time}`;
  return `${due.toLocaleString("ru-RU", { timeZone: "Europe/Chisinau", day: "2-digit", month: "short" })}, ${time}`;
};

// Самая заметная плашка карточки говорила «Не назначен» — и на этом всё. Теперь
// она либо называет шаг и срок, либо предлагает шаг поставить.
function NextStep({ tasks, onPlan }: { tasks: Task[]; onPlan: () => void }) {
  const next = tasks
    .filter((task) => !task.done_at)
    .sort((a, b) => a.due_at.localeCompare(b.due_at))[0];
  if (!next) {
    return (
      <button type="button" className={`${styles.highlight} ${styles.highlightAction}`} onClick={onPlan}>
        <span>Следующий шаг</span>
        <strong>Поставить задачу</strong>
      </button>
    );
  }
  const overdue = new Date(next.due_at) < new Date();
  return (
    <div className={`${styles.highlight} ${overdue ? styles.overdue : ""}`}>
      <span>Следующий шаг{overdue ? " · просрочен" : ""}</span>
      <strong title={next.title}>{next.title}</strong>
      <em className={styles.highlightMeta}>{fmtDue(next.due_at)}</em>
    </div>
  );
}
const dayLabel = (value: string) => new Date(value).toLocaleDateString("ru-RU", { timeZone: "Europe/Chisinau", day: "numeric", month: "long", year: "numeric" });
const initials = (value: string) => value.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();

// Иконка у подписи означает ТИП атрибута (text/number/select/date/user),
// а не смысл поля: «Объект» и «Телефоны» — текст, «Ответственный» — user.
type FieldTypeKind = "text" | "number" | "select" | "date" | "user";
const typeIconMap = { text: Type, number: Hash, select: List, date: CalendarDays, user: User, checkbox: CheckSquare } as const;
function TypeIcon({ kind }: { kind: FieldTypeKind | "checkbox" }) {
  const Icon = typeIconMap[kind];
  return <Icon size={14} className={styles.typeIcon} aria-hidden="true" />;
}

function EmptyLine({ children }: { children: React.ReactNode }) { return <p className={styles.emptyLine}>{children}</p>; }

function CustomValueField({ definition, value, dealId, fallback = null, label, multiline = false }: { definition: DealFieldDefinition; value: DealFieldValue | undefined; dealId: string; fallback?: string | null; label?: string; multiline?: boolean }) {
  const router = useRouter();
  const serverValue = valueToString(value?.value) ?? fallback;
  const [current, setCurrent] = useState(serverValue);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current ?? "");
  const [saving, setSaving] = useState(false);
  const options = normalizeOptions(definition.options);
  // Серверное значение и локальное живут отдельно (оптимистичное сохранение);
  // сверка — прямо в рендере, как советует React, без useEffect.
  const [syncedServer, setSyncedServer] = useState(serverValue);
  if (syncedServer !== serverValue) { setSyncedServer(serverValue); setCurrent(serverValue); }
  const display = current && definition.field_type === "select" ? options.find((option) => option.value === current)?.label ?? current : current;
  async function commit(next: string) {
    const stored = next.trim() || null; setEditing(false); if (stored === current) return; const previous = current; setCurrent(stored); setSaving(true); const db = createClient();
    const result = value ? await db.from("custom_field_values").update({ value: stored }).eq("id", value.id) : await db.from("custom_field_values").upsert({ field_id: definition.id, entity_id: dealId, value: stored }, { onConflict: "field_id,entity_id" });
    setSaving(false); if (result.error) { setCurrent(previous); toast.error(`${label ?? definition.label} не сохранилось. Попробуйте ещё раз.`); return; } toast.success(`${definition.label} — сохранено`); router.refresh();
  }
  const checked = current === "true" || current === "1" || current?.toLowerCase() === "да";
  return <div className={`field-row ${saving ? styles.fieldSaving : ""}`}><span><TypeIcon kind={definition.field_type} />{label ?? definition.label}</span>{editing ? definition.field_type === "select" ? <select className="field-input" autoFocus value={draft} onChange={(event) => commit(event.target.value)} onBlur={() => setEditing(false)} onKeyDown={(event) => event.key === "Escape" && setEditing(false)}><option value="">— не выбрано —</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : definition.field_type === "date" ? <DateField className="field-input" value={draft} onChange={commit} onClose={() => setEditing(false)} defaultOpen clearable aria-label={label ?? definition.label} placeholder="—" /> : definition.field_type === "checkbox" ? <input className="field-input" autoFocus type="checkbox" checked={draft === "true" || draft === "1"} onChange={(event) => commit(event.target.checked ? "true" : "")} onBlur={() => setEditing(false)} onKeyDown={(event) => event.key === "Escape" && setEditing(false)} aria-label={label ?? definition.label} /> : multiline ? <textarea className="field-textarea" autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={(event) => commit(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setEditing(false); if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); commit(draft); } }} /> : <input className="field-input" autoFocus type={definition.field_type === "number" ? "number" : "text"} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={(event) => commit(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setEditing(false); if (event.key === "Enter") commit(draft); }} /> : <button type="button" className={`field-value ${current ? "" : "is-empty"}`} onClick={() => { setDraft(current ?? ""); setEditing(true); }} title="Нажмите, чтобы изменить">{definition.field_type === "checkbox" ? (checked ? "Да" : "—") : (display ?? "—")}</button>}</div>;
}

function AttributionField({ label, value, deal }: { label: string; value: string | null; deal: DealRecordData["deal"] }) {
  const router = useRouter(); const [current, setCurrent] = useState(value); const [editing, setEditing] = useState(false); const [draft, setDraft] = useState(value ?? "");
  const [syncedServer, setSyncedServer] = useState(value);
  if (syncedServer !== value) { setSyncedServer(value); setCurrent(value); }
  const lock = useDealLock();
  async function commit(next: string) {
    const stored = next.trim() || null; setEditing(false); if (stored === current) return; const previous = current; setCurrent(stored);
    const patch = { utm: { ...(deal.utm ?? {}), [label]: stored } };
    const result = lock ? await lock.save(patch, { label, column: "utm", was: JSON.stringify(deal.utm ?? {}), next: stored }) : { status: "error" as const, error: (await createClient().from("deals").update(patch).eq("id", deal.id)).error };
    if (result.status === "conflict") { setCurrent(previous); router.refresh(); return; }
    if (result.status === "error" && result.error) { setCurrent(previous); toast.error(dbErrorText(result.error, `${label} не сохранилось. Попробуйте ещё раз.`)); return; }
    toast.success(`${label} — сохранено`); router.refresh();
  }
  return <div className="field-row"><span><TypeIcon kind="text" />{attributionLabels[label as keyof Attribution]}</span>{editing ? <input className="field-input" autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={(event) => commit(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setEditing(false); if (event.key === "Enter") commit(draft); }} /> : <button type="button" className={`field-value ${current ? "" : "is-empty"}`} onClick={() => { setDraft(current ?? ""); setEditing(true); }}>{current ?? "—"}</button>}</div>;
}

// Смена этапа из карточки идёт тем же путём, что и на канбане: гейты считает
// stage-gate, спрашивает StageGateDialog, ошибку базы показываем как есть.
type StageGate = { target: Stage; plan: GatePlan };

function StageField({ data, stageId, onStageChanged }: { data: DealRecordData; stageId: string; onStageChanged: (nextStageId: string, nextStatus: string, lost: { reasonName: string | null; comment: string | null } | null) => void }) {
  const router = useRouter(); const [editing, setEditing] = useState(false); const [busy, setBusy] = useState(false);
  const [gate, setGate] = useState<StageGate | null>(null); const [gateError, setGateError] = useState<string | null>(null);
  const [form, setForm] = useState<GateForm>(() => emptyGateForm(data.taskTypes[0]?.id ?? "", data.deal.owner_id ?? data.currentUser.id));
  useEffect(() => {
    if (!gate) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) { setGate(null); setGateError(null); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gate, busy]);
  const currentStage = data.allStages.find((stage) => stage.id === stageId);
  async function finish(target: Stage, result: { stage_id: string; status: string }, lost: { reasonName: string | null; comment: string | null } | null) {
    onStageChanged(result.stage_id ?? target.id, result.status ?? data.deal.status, lost);
    setEditing(false); setGate(null); setGateError(null);
    toast.success("Этап — сохранено"); router.refresh();
  }
  async function pickStage(targetStageId: string) {
    const target = data.allStages.find((stage) => stage.id === targetStageId);
    if (!target || target.id === stageId) { setEditing(false); return; }
    const forward = target.kind === "open" && target.position > (currentStage?.position ?? 0);
    const unqualified = forward && data.tags.some((tag) => tag.name === "неквал");
    let plan: GatePlan | null = null;
    if (target.kind === "lost" || unqualified || (forward && targetHasGates(target))) {
      setBusy(true);
      try {
        const snapshot = await loadGateSnapshot(createClient(), data.deal.id, target.requires_qualification === true && target.kind !== "lost");
        plan = planGate({ target, source: currentStage, stages: data.allStages, snapshot, qualification: "" });
      } catch (cause) { setBusy(false); setEditing(false); toast.error(transitionErrorText(cause)); return; }
      setBusy(false);
    }
    if (plan && (plan.lost || plan.needsQualification || plan.needsTask || plan.missingFields.length > 0 || plan.blocked)) {
      setForm({ ...emptyGateForm(data.taskTypes[0]?.id ?? "", data.deal.owner_id ?? data.currentUser.id), taskDueAt: plan.needsTask ? tomorrowMorning() : "" });
      setGateError(null); setEditing(false); setGate({ target, plan });
      return;
    }
    setBusy(true);
    const result = await transitionDeal(createClient(), { dealId: data.deal.id, stageId: target.id, ownerId: data.deal.owner_id });
    setBusy(false);
    if (!result.ok) { setEditing(false); toast.error(result.message); return; }
    await finish(target, result.data, null);
  }
  async function submitGate() {
    if (!gate || busy) return;
    const { plan, target } = gate;
    if (plan.blocked || plan.missingFields.length) return;
    if ((plan.lost && !form.reasonId) || (plan.needsQualification && !form.qualification) || (plan.needsTask && (!form.taskTitle.trim() || !form.taskDueAt || !form.taskTypeId || !form.taskAssigneeId))) { setGateError("Заполните обязательные поля"); return; }
    if (plan.needsQualification && form.qualification === "неквал" && unqualifiedBlocks(target, data.allStages)) return;
    const due = plan.needsTask ? new Date(form.taskDueAt) : null;
    if (due && (!Number.isFinite(due.getTime()) || due.getTime() <= Date.now())) { setGateError("Дата следующего шага должна быть в будущем"); return; }
    setBusy(true); setGateError(null);
    try {
      const db = createClient();
      const result = await transitionDeal(db, { dealId: data.deal.id, stageId: target.id, ownerId: data.deal.owner_id, lostReasonId: plan.lost ? form.reasonId : null, lostComment: plan.lost ? form.comment : null, qualification: form.qualification, task: plan.needsTask && due ? { title: form.taskTitle.trim(), dueAt: due.toISOString(), typeId: form.taskTypeId, assigneeId: form.taskAssigneeId } : null });
      if (!result.ok) { setGateError(result.message); return; }
      // Число задач из снимка не ждём: задачу могли поставить после того, как модалка прочитала сделку.
      if (plan.lost && form.closeTasks) {
        const closed = await closeOpenTasks(db, data.deal.id, data.currentUser.id);
        if (closed.failed) toast.error("Сделка закрыта, но открытые задачи закрыть не удалось");
      }
      await finish(target, result.data, plan.lost ? { reasonName: data.allLostReasons.find((reason) => reason.id === form.reasonId)?.name ?? null, comment: form.comment.trim() || null } : null);
    } catch (cause) {
      setGateError(transitionErrorText(cause));
    } finally {
      setBusy(false);
    }
  }
  const stageName = data.stage?.name ?? currentStage?.name ?? "—";
  return <div className="field-row"><span><TypeIcon kind="select" />Этап</span>{editing ? <select className="field-input" autoFocus disabled={busy} defaultValue={stageId} onChange={(event) => void pickStage(event.target.value)} onBlur={() => setEditing(false)}>{data.allStages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select> : <button type="button" className="field-value" disabled={busy} onClick={() => setEditing(true)}>{currentStage ? <StageIndicator stage={currentStage} stages={data.allStages} name={stageName} variant="inline" /> : stageName}</button>}
    {gate && <StageGateDialog plan={gate.plan} target={gate.target} stages={data.allStages} form={form} setForm={setForm} lostReasons={data.allLostReasons} taskTypes={data.taskTypes} assignees={data.allOwners.map((owner) => ({ id: owner.id, name: owner.full_name }))} pending={busy} error={gateError} onCancel={() => { setGate(null); setGateError(null); }} onSubmit={() => void submitGate()} onOpenDeal={() => { setGate(null); }} openLabel="Заполнить поля" />}
  </div>;
}

export function DealRecordClient({ data }: { data: DealRecordData }) {
  return <DealLockProvider dealId={data.deal.id} updatedAt={data.deal.updated_at}><DealRecord data={data} /></DealLockProvider>;
}

function DealRecord({ data }: { data: DealRecordData }) {
  // Исполнитель новой задачи по умолчанию — ответственный за сделку (если он ещё работает), иначе автор.
  const defaultAssignee = data.deal.owner_id && data.allOwners.some((owner) => owner.id === data.deal.owner_id) ? data.deal.owner_id : data.currentUser.id;
  const [taskAssignee, setTaskAssignee] = useState(""); const [taskRemind, setTaskRemind] = useState("");
  const router = useRouter(); const [tab, setTab] = useState("all"); const [note, setNote] = useState(""); const [taskTitle, setTaskTitle] = useState(""); const [taskDue, setTaskDue] = useState(""); const [noteSaving, setNoteSaving] = useState(false); const [taskSaving, setTaskSaving] = useState(false); const [entrySaving, setEntrySaving] = useState(false); const [feedback, setFeedback] = useState<string | null>(null); const [completionTask, setCompletionTask] = useState<Task | null>(null); const [completionResult, setCompletionResult] = useState(""); const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null); const [editingNote, setEditingNote] = useState<{ id: string; draft: string } | null>(null); const [sourceOpen, setSourceOpen] = useState(false); const deleteTriggerRef = useRef<HTMLButtonElement | null>(null); const taskInputRef = useRef<HTMLInputElement | null>(null);
  // Лента и шапка живут локально и обновляются сразу после действия —
  // без ожидания router.refresh(), иначе до F5 виден stale UI.
  const [stageId, setStageId] = useState(data.deal.stage_id);
  const [status, setStatus] = useState(data.deal.status);
  // Причина отказа: из базы при загрузке, из формы — сразу после закрытия.
  const [lostInfo, setLostInfo] = useState<{ reasonName: string | null; comment: string | null } | null>(data.deal.status === "lost" ? { reasonName: data.lostReasonName, comment: (data.deal.lost_comment as string | null) ?? null } : null);
  const [localNotes, setLocalNotes] = useState(data.notes);
  const [localTasks, setLocalTasks] = useState(data.tasks);
  const [localTransitions, setLocalTransitions] = useState(data.transitions);
  // Серверные данные и локальные (оптимистичные) списки живут отдельно:
  // сверка — прямо в рендере, без useEffect.
  const [syncedStage, setSyncedStage] = useState(data.deal.stage_id);
  if (syncedStage !== data.deal.stage_id) { setSyncedStage(data.deal.stage_id); setStageId(data.deal.stage_id); setStatus(data.deal.status); setLostInfo(data.deal.status === "lost" ? { reasonName: data.lostReasonName, comment: (data.deal.lost_comment as string | null) ?? null } : null); }
  const [syncedNotes, setSyncedNotes] = useState(data.notes);
  if (syncedNotes !== data.notes) { setSyncedNotes(data.notes); setLocalNotes(data.notes); }
  const [syncedTasks, setSyncedTasks] = useState(data.tasks);
  if (syncedTasks !== data.tasks) { setSyncedTasks(data.tasks); setLocalTasks(data.tasks); }
  const [syncedTransitions, setSyncedTransitions] = useState(data.transitions);
  if (syncedTransitions !== data.transitions) { setSyncedTransitions(data.transitions); setLocalTransitions(data.transitions); }
  const people = useMemo(() => new Map([...data.people.map((person) => [person.id, person] as const), [data.currentUser.id, data.currentUser] as const]), [data.people, data.currentUser]); const stageNames = useMemo(() => new Map(data.transitionStages.map((stage) => [stage.id, stage.name])), [data.transitionStages]); const customValues = useMemo(() => new Map(data.fieldValues.map((value) => [value.field_id, value])), [data.fieldValues]);
  const attributionValues = useMemo(() => { const byKey = new Map(data.fieldDefs.map((definition) => [definition.key, valueToString(customValues.get(definition.id)?.value)])); return buildAttribution(data.deal.utm, data.deal.amo_custom_fields, byKey); }, [customValues, data.deal.amo_custom_fields, data.deal.utm, data.fieldDefs]);
  const semanticDefinitions = useMemo(() => {
    const result = new Map<string, DealFieldDefinition>();
    for (const definition of data.fieldDefs) {
      if (isAttributionField(definition.key, definition.label)) continue;
      const semanticKey = canonicalFieldKey(definition.key, definition.label);
      if (!semanticKey) continue;
      const current = result.get(semanticKey);
      const hasValue = Boolean(valueToString(customValues.get(definition.id)?.value));
      const currentHasValue = Boolean(current && valueToString(customValues.get(current.id)?.value));
      if (!current || (hasValue && !currentHasValue)) result.set(semanticKey, definition);
    }
    return result;
  }, [customValues, data.fieldDefs]);
  // «Пожелания» могли завести пользовательским полем: тогда читаем и пишем
  // туда (иначе значение «теряется» между колонкой и справочником).
  const wishesDefinition = useMemo(() => {
    const norm = (raw: string) => raw.toLowerCase().replaceAll("ё", "е").replace(/[^a-zа-я0-9]+/g, "");
    return data.fieldDefs.find((definition) => !isAttributionField(definition.key, definition.label) && norm(`${definition.key} ${definition.label}`).includes("пожелани"));
  }, [data.fieldDefs]);
  const customDefinitions = data.fieldDefs.filter((definition) => !isAttributionField(definition.key, definition.label) && !canonicalFieldKey(definition.key, definition.label) && definition.id !== wishesDefinition?.id);
  const hasAttribution = Object.values(attributionValues).some(Boolean);
  const changeEvents = data.changes.events.filter((event) => describeChanges(event.changes, data.changes.names).length > 0);
  const feed: FeedEntry[] = [...changeEvents.map((item) => ({ type: "changes" as const, date: item.at, item })), ...data.calls.map((item) => ({ type: "calls" as const, date: item.started_at, item })), ...localNotes.map((item) => ({ type: "notes" as const, date: item.created_at, item })), ...localTasks.map((item) => ({ type: "tasks" as const, date: item.due_at, item })), ...localTransitions.map((item) => ({ type: "stages" as const, date: item.changed_at, item }))].filter((item) => tab === "all" || item.type === tab).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const groupedFeed = feed.reduce<{ date: string; entries: FeedEntry[] }[]>((groups, entry) => { const date = dayLabel(entry.date); const current = groups.find((group) => group.date === date); if (current) current.entries.push(entry); else groups.push({ date, entries: [entry] }); return groups; }, []);
  const latestLostTransitionId = localTransitions.filter((item) => item.to_status === "lost").sort((a, b) => b.changed_at.localeCompare(a.changed_at))[0]?.id;
  const counts = { calls: data.calls.length, notes: localNotes.length, tasks: localTasks.length, stages: localTransitions.length, changes: changeEvents.length };
  const saveError = (message: string) => { setFeedback(message); toast.error(message); };
  function handleStageChanged(nextStageId: string, nextStatus: string, lost: { reasonName: string | null; comment: string | null } | null) {
    setLostInfo(nextStatus === "lost" ? lost : null);
    setLocalTransitions((current) => [{ id: `local-${Date.now()}`, from_stage_id: stageId, to_stage_id: nextStageId, from_status: status, to_status: nextStatus, changed_by: data.currentUser.id, changed_at: new Date().toISOString() }, ...current]);
    setStageId(nextStageId);
    setStatus(nextStatus);
  }
  async function createNote(event?: FormEvent) {
    event?.preventDefault();
    const body = note.trim();
    if (!body || noteSaving || taskSaving) return;
    setNoteSaving(true);
    const result = await createClient().from("notes").insert({ deal_id: data.deal.id, author_id: data.currentUser.id, body }).select("id, deal_id, author_id, body, created_at, edited_at, amo_id, amo_note_type").single();
    setNoteSaving(false);
    if (result.error || !result.data) { saveError("Примечание не сохранилось. Попробуйте ещё раз."); return; }
    setLocalNotes((current) => [result.data as Note, ...current]);
    setNote("");
    setFeedback("Примечание добавлено");
    router.refresh();
  }
  async function createTask(event: FormEvent) {
    event.preventDefault();
    const title = taskTitle.trim();
    if (!title || !taskDue || noteSaving || taskSaving) return;
    // Задача с прошедшей датой сразу просрочена и не может быть следующим шагом.
    if (new Date(taskDue).getTime() <= Date.now()) { saveError("Срок задачи уже прошёл — выберите время в будущем"); return; }
    const dueAt = new Date(taskDue);
    const remindAt = taskRemind ? new Date(dueAt.getTime() - Number(taskRemind) * 60000) : null;
    if (remindAt && remindAt.getTime() <= Date.now()) { saveError("Напоминание уже в прошлом — выберите ближе к сроку или без напоминания"); return; }
    setTaskSaving(true);
    const result = await createClient().from("tasks").insert({ deal_id: data.deal.id, assignee_id: taskAssignee || defaultAssignee, title, due_at: dueAt.toISOString(), remind_at: remindAt?.toISOString() ?? null, created_by: data.currentUser.id }).select("id, deal_id, assignee_id, title, due_at, done_at, done_by, created_at, is_auto, result_text").single();
    setTaskSaving(false);
    if (result.error || !result.data) { saveError("Задача не сохранилась. Попробуйте ещё раз."); return; }
    setLocalTasks((current) => [result.data as Task, ...current]);
    setTaskTitle(""); setTaskDue(""); setTaskRemind("");
    setFeedback("Задача добавлена");
    router.refresh();
  }
  async function saveEditedNote() {
    if (!editingNote || !editingNote.draft.trim() || entrySaving) return;
    setEntrySaving(true);
    const result = await createClient().from("notes").update({ body: editingNote.draft.trim() }).eq("id", editingNote.id);
    setEntrySaving(false);
    if (result.error) { saveError("Примечание не сохранилось. Попробуйте ещё раз."); return; }
    setLocalNotes((current) => current.map((item) => item.id === editingNote.id ? { ...item, body: editingNote.draft.trim(), edited_at: new Date().toISOString() } : item));
    setEditingNote(null);
    setFeedback("Примечание обновлено");
    router.refresh();
  }
  async function completeTask(event: FormEvent) { event.preventDefault(); if (!completionTask || !completionResult.trim() || entrySaving) return; setEntrySaving(true); const result = await createClient().from("tasks").update({ result_text: completionResult.trim(), done_at: new Date().toISOString(), done_by: data.currentUser.id }).eq("id", completionTask.id).is("done_at", null); setEntrySaving(false); if (result.error) saveError("Не удалось выполнить задачу. Попробуйте ещё раз."); else { setLocalTasks((current) => current.map((item) => item.id === completionTask.id ? { ...item, result_text: completionResult.trim(), done_at: new Date().toISOString(), done_by: data.currentUser.id } : item)); setCompletionTask(null); setCompletionResult(""); setFeedback("Задача выполнена"); router.refresh(); } }
  async function deleteEntry(event: FormEvent) { event.preventDefault(); if (!deleteTarget || entrySaving) return; setEntrySaving(true); const result = await createClient().rpc("soft_delete_crm_record", { p_entity: deleteTarget.entity, p_id: deleteTarget.id }); setEntrySaving(false); if (result.error) saveError("Не удалось удалить. Попробуйте ещё раз."); else { if (deleteTarget.entity === "notes") setLocalNotes((current) => current.filter((item) => item.id !== deleteTarget.id)); else setLocalTasks((current) => current.filter((item) => item.id !== deleteTarget.id)); setDeleteTarget(null); setFeedback("Запись удалена"); router.refresh(); } }
  const namedField = (semanticKey: string, label: string, column: string, value: string | null, type?: "text" | "number" | "select", options?: { value: string; label: string }[], extra?: { validate?: (value: string) => string | null; numeric?: boolean }) => {
    const definition = semanticDefinitions.get(semanticKey);
    if (definition) return <CustomValueField definition={definition} value={customValues.get(definition.id)} dealId={data.deal.id} fallback={value} label={label} />;
    const icon = <TypeIcon kind={type === "select" ? "select" : type === "number" ? "number" : "text"} />;
    return type === "select"
      ? <InlineField icon={icon} label={label} table="deals" id={data.deal.id} column={column} type="select" value={value} options={options ?? []} numeric={extra?.numeric} />
      : <InlineField icon={icon} label={label} table="deals" id={data.deal.id} column={column} type={type} value={value} validate={extra?.validate} />;
  };
  const currentStage = data.allStages.find((stage) => stage.id === stageId);
  return <main className={`${styles.main} record-main`}>
    <div className={styles.highlights}><NextStep tasks={localTasks} onPlan={() => { setTab("all"); taskInputRef.current?.focus(); }} /><div className={styles.highlight}><span>Этап</span><strong>{currentStage ? <StageIndicator stage={currentStage} stages={data.allStages} name={currentStage.name} variant="inline" /> : (data.stage?.name ?? "—")}</strong></div><div className={styles.highlight}><span>Ежемесячный платёж</span><strong>{monthlyAmount(data.deal.monthly_payment_text as string | null) ?? fmtMoney(data.deal.monthly_payment as number | null, data.deal.budget_currency) ?? "—"}</strong></div><div className={styles.highlight}><span>Первый взнос</span><strong>{shortAmount(data.deal.down_payment_text as string | null) ?? fmtMoney(data.deal.down_payment as number | null, data.deal.budget_currency) ?? "—"}</strong></div></div>
    <div className={styles.body}><aside className={styles.left}>
      <section className={styles.section}><div className={styles.contactHead}><div className={styles.avatar}>{initials(data.contact?.full_name ?? "?")}</div><h2>{data.contact ? <Link href={`/contacts/${data.contact.id}`} title="Открыть контакт" style={{ color: "var(--info)" }}>{data.contact.full_name}</Link> : "Без имени"}</h2></div><ReadField icon={<TypeIcon kind="text" />} label="Имя" value={data.contact?.full_name} /><ReadField icon={<TypeIcon kind="text" />} label="Телефоны" value={data.phones.length ? data.phones.map((phone) => phone.phone).join(", ") : null} /><ReadField icon={<TypeIcon kind="text" />} label="Канал" value={data.channels.length ? data.channels.map((channel) => channel.channel).join(", ") : null} /></section>
      <section className={styles.section}><h3>Сделка</h3><InlineField icon={<TypeIcon kind="text" />} label="Название" table="deals" id={data.deal.id} column="title" value={data.deal.title} /><StageField data={data} stageId={stageId} onStageChanged={handleStageChanged} /><InlineField icon={<TypeIcon kind="user" />} label="Ответственный" table="deals" id={data.deal.id} column="owner_id" type="select" value={data.deal.owner_id} options={[{ value: "", label: "Общий котёл" }, ...data.allOwners.map((owner) => ({ value: owner.id, label: owner.full_name }))]} /><ReadField icon={<TypeIcon kind="select" />} label="Статус" value={labels[status] ?? status} />{status === "lost" && <ReadField icon={<TypeIcon kind="select" />} label="Причина отказа" value={lostInfo?.reasonName ?? "Не указана"} />}{status === "lost" && lostInfo?.comment && <ReadField icon={<TypeIcon kind="text" />} label="Комментарий к отказу" value={lostInfo.comment} />}<InlineField icon={<TypeIcon kind="text" />} label="Объект" table="deals" id={data.deal.id} column="object_text" value={data.deal.object_text} /><InlineField icon={<TypeIcon kind="select" />} label="Источник" table="deals" id={data.deal.id} column="source_id" type="select" value={data.deal.source_id} options={[{ value: "", label: "— не выбран —" }, ...data.allSources.map((source) => ({ value: source.id, label: source.name }))]} /><InlineField icon={<TypeIcon kind="number" />} label="Бюджет" table="deals" id={data.deal.id} column="budget" type="number" min={0} validate={budgetError} value={data.deal.budget === null ? null : String(data.deal.budget)} format={(value) => fmtMoney(Number(value), data.deal.budget_currency) ?? "—"} /></section>
      <section className={styles.section}><h3>Проект и метки</h3><ProjectField dealId={data.deal.id} selected={data.projects} options={data.allProjects} /><TagsField dealId={data.deal.id} selected={data.tags} options={data.allTags} /></section>
      <section className={styles.section}><h3>Квалификация</h3>{namedField("construction_stage", "Этап строительства", "construction_stage", data.deal.construction_stage ?? null)}<InlineField icon={<TypeIcon kind="text" />} label="Ежемесячный платёж" table="deals" id={data.deal.id} column="monthly_payment_text" value={(data.deal.monthly_payment_text ?? fmtMoney(data.deal.monthly_payment, data.deal.budget_currency)) ?? null} serverValue={data.deal.monthly_payment_text ?? null} suggestions={MONTHLY_PAYMENT_PRESETS} validate={(value) => amountError(value, "Ежемесячный платёж")} /><InlineField icon={<TypeIcon kind="text" />} label="Первый взнос" table="deals" id={data.deal.id} column="down_payment_text" value={(data.deal.down_payment_text ?? fmtMoney(data.deal.down_payment, data.deal.budget_currency)) ?? null} serverValue={data.deal.down_payment_text ?? null} suggestions={DOWN_PAYMENT_PRESETS} validate={(value) => amountError(value, "Первый взнос")} />{namedField("payment", "Способ оплаты", "payment", data.deal.payment ?? null, "select", [{ value: "cash", label: "Наличные" }, { value: "mortgage", label: "Ипотека" }, { value: "installment", label: "Рассрочка" }])}<InlineField icon={<TypeIcon kind="text" />} label="Срок покупки" table="deals" id={data.deal.id} column="purchase_timing_text" value={(data.deal.purchase_timing_text ?? data.deal.horizon) ?? null} serverValue={data.deal.purchase_timing_text ?? null} month validate={monthError} format={(value) => formatMonth(value ?? "")} /><InlineField icon={<TypeIcon kind="select" />} label="В стране" table="deals" id={data.deal.id} column="residency" type="select" value={(data.deal.residency ?? data.deal.residency_detail) ?? null} serverValue={(data.deal.residency as string | null) ?? null} options={RESIDENCY_OPTIONS} extra={{ residency_detail: null }} /><InlineField icon={<TypeIcon kind="select" />} label="Цель покупки" table="deals" id={data.deal.id} column="purpose" type="select" value={data.deal.purpose} options={[{ value: "living", label: "Для жизни" }, { value: "investment", label: "Инвестиция" }]} />{namedField("rooms", "Комнатность", "rooms", data.deal.rooms === null ? null : String(data.deal.rooms), "select", ROOM_OPTIONS, { numeric: true })}{namedField("area_m2", "Площадь, м²", "desired_area_text", data.deal.desired_area_text ?? null, "text", undefined, { validate: (value) => sizeError(value, "Площадь") })}{namedField("floor", "Этаж", "desired_floor_text", data.deal.desired_floor_text ?? null, "text", undefined, { validate: (value) => sizeError(value, "Этаж") })}{wishesDefinition ? <CustomValueField definition={wishesDefinition} value={customValues.get(wishesDefinition.id)} dealId={data.deal.id} fallback={data.deal.wishes ?? null} label="Пожелания" multiline /> : <InlineField icon={<TypeIcon kind="text" />} label="Пожелания" table="deals" id={data.deal.id} column="wishes" type="textarea" value={data.deal.wishes ?? null} />}</section>
      <section className={styles.section}><h3>Пользовательские поля</h3>{customDefinitions.length ? customDefinitions.map((definition) => <CustomValueField key={definition.id} definition={definition} value={customValues.get(definition.id)} dealId={data.deal.id} />) : <EmptyLine>Пользовательские поля ещё не настроены.</EmptyLine>}</section>
      <section className={styles.section}><button type="button" className={styles.sourceToggle} aria-expanded={sourceOpen} onClick={() => setSourceOpen((open) => !open)}><span>{hasAttribution ? "Источник и атрибуция" : "Атрибуция не записана"}</span><span>{sourceOpen ? "−" : "+"}</span></button><div className={`${styles.sourcePanel} ${sourceOpen ? styles.sourcePanelOpen : ""}`}><div>{(Object.keys(attributionValues) as (keyof Attribution)[]).map((key) => <AttributionField key={key} label={key} value={attributionValues[key]} deal={data.deal} />)}</div></div></section>
    </aside><section className={styles.right}>
      <div className={styles.tabs} role="tablist">{([["all", "Все"], ["calls", "Звонки"], ["notes", "Примечания"], ["tasks", "Задачи"], ["stages", "Этапы"], ["changes", "Изменения"]] as const).map(([value, label]) => <button type="button" role="tab" aria-selected={tab === value} className={tab === value ? styles.activeTab : ""} onClick={() => setTab(value)} key={value}>{label}{value !== "all" ? <span className={styles.tabCount}>{counts[value]}</span> : null}</button>)}</div>
      <div className={styles.quickActions}><form className={cardStyles.noteForm} onSubmit={createNote}><textarea rows={1} value={note} onChange={(event) => setNote(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void createNote(); } }} placeholder="Написать примечание… (Ctrl+Enter — сохранить)" aria-label="Примечание" disabled={noteSaving} /><button className="btn btn-primary" disabled={noteSaving || taskSaving || !note.trim()} title="Ctrl+Enter">{noteSaving ? "Сохранение…" : "Сохранить"}</button></form><form onSubmit={createTask} style={{ flexWrap: "wrap" }}><input ref={taskInputRef} value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Новая задача" aria-label="Название задачи" disabled={taskSaving} /><DateField type="datetime-local" disablePast value={taskDue} onChange={setTaskDue} aria-label="Дата и время задачи" placeholder="Срок" /><button className="btn btn-primary" disabled={noteSaving || taskSaving || !taskTitle.trim() || !taskDue}>{taskSaving ? "Сохранение…" : <><Plus size={14} /> Задача</>}</button><div className={cardStyles.taskMore}><label>Исполнитель<select value={taskAssignee || defaultAssignee} onChange={(event) => setTaskAssignee(event.target.value)} disabled={taskSaving} aria-label="Исполнитель задачи">{data.allOwners.map((owner) => <option key={owner.id} value={owner.id}>{owner.full_name}</option>)}{!data.allOwners.some((owner) => owner.id === data.currentUser.id) && <option value={data.currentUser.id}>{data.currentUser.full_name}</option>}</select></label><label>Напомнить<select value={taskRemind} onChange={(event) => setTaskRemind(event.target.value)} disabled={taskSaving} aria-label="Напоминание о задаче"><option value="">не нужно</option><option value="15">за 15 минут</option><option value="60">за 1 час</option><option value="1440">за 1 день</option></select></label></div></form></div>
      <div className={`${styles.feed} motion-list`}>{groupedFeed.length === 0 ? <div className={styles.emptyState}><MessageCircle size={18} /><strong>Пока нет записей</strong><EmptyLine>Добавьте примечание или задачу — они появятся здесь.</EmptyLine></div> : groupedFeed.map((group, index) => <div className={styles.feedGroup} key={group.date} style={{ "--i": index } as CSSProperties}><h3>{group.date}</h3>{group.entries.map((entry) => <div className={styles.feedRow} key={`${entry.type}-${entry.item.id}`}>
        {entry.type === "calls" && <><Phone size={15} /><div><strong>{entry.item.direction === "in" ? "Входящий звонок" : "Исходящий звонок"}</strong><span className={styles.muted}>{entry.item.from_phone ?? entry.item.to_phone ?? ""} · {entry.item.duration_sec ? `${Math.floor(entry.item.duration_sec / 60)} мин` : entry.item.status ?? "без ответа"}</span>{entry.item.recording_url && <audio controls src={entry.item.recording_url} />}</div><time>{fmtDate(entry.date)}</time></>}
        {entry.type === "notes" && <><FileText size={15} /><div>{editingNote?.id === entry.item.id ? <><textarea className="field-textarea" autoFocus value={editingNote.draft} disabled={entrySaving} onChange={(event) => setEditingNote({ id: entry.item.id, draft: event.target.value })} onKeyDown={(event) => { if (event.key === "Escape") setEditingNote(null); if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void saveEditedNote(); } }} aria-label="Текст примечания" /><div className={styles.modalActions} style={{ justifyContent: "flex-start", marginTop: 6 }}><button type="button" onClick={() => setEditingNote(null)} disabled={entrySaving}>Отмена</button><button type="button" onClick={() => void saveEditedNote()} disabled={entrySaving || !editingNote.draft.trim()} title="Ctrl+Enter">{entrySaving ? "Сохраняем…" : "Сохранить"}</button></div></> : <><p>{entry.item.body}</p><span className={styles.muted}>{people.get(entry.item.author_id ?? "")?.full_name ?? "Сотрудник"}{entry.item.edited_at && <span className={cardStyles.edited} title={`Изменено ${fmtDate(entry.item.edited_at)}`}> · изменено</span>}</span><span>{entry.item.author_id === data.currentUser.id && <button className={styles.deleteAction} type="button" onClick={() => setEditingNote({ id: entry.item.id, draft: entry.item.body })}><Pencil size={14} /> Изменить</button>}<button className={styles.deleteAction} type="button" onClick={(event) => { deleteTriggerRef.current = event.currentTarget; setDeleteTarget({ entity: "notes", id: entry.item.id, label: entry.item.body }); }}><Trash2 size={14} /> Удалить</button></span></>}</div><time>{fmtDate(entry.date)}</time></>}
        {entry.type === "tasks" && <><Check size={15} /><div><button type="button" className={`${styles.taskButton} ${entry.item.done_at ? styles.done : ""}`} onClick={() => !entry.item.done_at && setCompletionTask(entry.item)}><span className={styles.taskCheck}>{entry.item.done_at ? <Check size={12} /> : null}</span>{entry.item.title}<span className={`${styles.muted} ${!entry.item.done_at && new Date(entry.item.due_at) < new Date() ? cardStyles.taskOverdue : ""}`}>{entry.item.done_at ? "Выполнена" : new Date(entry.item.due_at) < new Date() ? "Просрочена" : "Запланирована"}{entry.item.assignee_id ? ` · ${people.get(entry.item.assignee_id)?.full_name ?? "Сотрудник"}` : ""}</span></button>{entry.item.done_at && entry.item.result_text && <p className={styles.taskResult}>“{entry.item.result_text}”</p>}<button className={styles.deleteAction} type="button" onClick={(event) => { deleteTriggerRef.current = event.currentTarget; setDeleteTarget({ entity: "tasks", id: entry.item.id, label: entry.item.title }); }}><Trash2 size={14} /> Удалить</button></div><time>{fmtDate(entry.date)}</time></>}
        {entry.type === "changes" && <><History size={15} /><div>{describeChanges(entry.item.changes, data.changes.names).map((line) => <span className={cardStyles.changeLine} key={line.key}>{changeText(line)}</span>)}<span className={cardStyles.changeAuthor}>{data.changes.names[entry.item.actor_id ?? ""] ?? people.get(entry.item.actor_id ?? "")?.full_name ?? "Система"}</span></div><time>{fmtDate(entry.date)}</time></>}
        {entry.type === "stages" && <><Clock3 size={15} /><div><strong>{entry.item.from_stage_id && entry.item.from_stage_id !== entry.item.to_stage_id ? `${stageNames.get(entry.item.from_stage_id) ?? "Этап"} → ${stageNames.get(entry.item.to_stage_id) ?? "Этап"}` : `Заведена на этапе «${stageNames.get(entry.item.to_stage_id) ?? "Этап"}»`}</strong><span className={styles.muted}>{labels[entry.item.to_status] ?? entry.item.to_status} · {people.get(entry.item.changed_by ?? "")?.full_name ?? "Система"}</span>{status === "lost" && entry.item.id === latestLostTransitionId && <span className={styles.muted}>Причина: {lostInfo?.reasonName ?? "не указана"}{lostInfo?.comment ? ` — ${lostInfo.comment}` : ""}</span>}</div><time>{fmtDate(entry.date)}</time></>}
      </div>)}</div>)}</div>
    </section></div>
    {completionTask && <div className={`${styles.modalBackdrop} motion-veil`}><form className={`${styles.modal} motion-dialog`} onSubmit={completeTask}><div className={styles.modalHead}><h2>Результат задачи</h2><button type="button" onClick={() => setCompletionTask(null)} aria-label="Закрыть"><X size={16} /></button></div><p>{completionTask.title}</p><textarea autoFocus required value={completionResult} onChange={(event) => setCompletionResult(event.target.value)} placeholder="Что сделано" /><div className={styles.modalActions}><button type="button" onClick={() => setCompletionTask(null)}>Отмена</button><button type="submit" disabled={entrySaving || !completionResult.trim()}>{entrySaving ? "Сохраняем…" : "Выполнить задачу"}</button></div></form></div>}
    {deleteTarget && <div className={`${styles.modalBackdrop} motion-veil`}><form className={`${styles.modal} motion-dialog`} onSubmit={deleteEntry}><div className={styles.modalHead}><h2>Удалить запись?</h2><button type="button" onClick={() => setDeleteTarget(null)} aria-label="Закрыть"><X size={16} /></button></div><p>«{deleteTarget.label}» будет перемещено в корзину.</p><div className={styles.modalActions}><button type="button" onClick={() => setDeleteTarget(null)}>Отмена</button><button type="submit" disabled={entrySaving}>{entrySaving ? "Удаляем…" : "Удалить"}</button></div></form></div>}
    {feedback && <div className={styles.feedback} role="status">{feedback}</div>}
  </main>;
}
