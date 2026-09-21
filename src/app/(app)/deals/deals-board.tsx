"use client";

import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  ChevronDown,
  ChevronRight,
  Globe,
  House,
  MessageCircle,
  MoreHorizontal,
  Phone,
  Plus,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createClient } from "@/lib/supabase/client";

export type BoardTag = { id?: string; name: string; color?: string | null };
export type BoardProject = { id?: string; code?: string | null; name: string };
export type BoardCard = {
  id: string;
  contact_id: string;
  owner_id: string | null;
  stage_id: string;
  status: "open" | "postponed" | "won" | "lost";
  title: string | null;
  object_text: string | null;
  source_name: string | null;
  budget: number | null;
  budget_currency: string;
  monthly_payment_text: string | null;
  down_payment_text: string | null;
  postponed_until: string | null;
  updated_at: string;
  created_at?: string;
  contact_name: string | null;
  owner_name: string | null;
  phone: string | null;
  tags: BoardTag[];
  projects: BoardProject[];
  next_task: { title: string; due_at: string } | null;
  last_activity: { kind: string; text: string | null; at: string | null } | null;
};
export type BoardColumn = {
  id: string;
  title: string;
  total: number;
  sum: number | null;
  deals: BoardCard[];
  kettle?: boolean;
  won?: boolean;
  kind?: "open" | "won" | "lost";
  position?: number;
  requires_next_step?: boolean;
  requires_qualification_tag?: boolean;
};
type Option = { id: string; name: string };
type Props = {
  columns: BoardColumn[];
  lost: BoardColumn | null;
  currentUserId: string;
  lostReasons: Option[];
  taskTypes: Option[];
  activeAssignees: Option[];
};
type Gate = {
  deal: BoardCard;
  target: BoardColumn;
  sourceIndex: number;
  targetIndex: number;
  lost: boolean;
  needsQualification: boolean;
  needsTask: boolean;
};
type GateForm = {
  qualification: "КВАЛ" | "неквал" | "";
  reasonId: string;
  comment: string;
  taskTitle: string;
  taskDueAt: string;
  taskTypeId: string;
  taskAssigneeId: string;
};
type MobileConfirmation = { dealId: string; targetId: string; destination: string };

function initials(name: string) {
  return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function time(value: string) {
  return new Date(value).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function relative(value: string | null | undefined) {
  if (!value) return "пока нет";
  const delta = Date.now() - new Date(value).getTime();
  if (delta < 60_000) return "только что";
  if (delta < 3_600_000) return `${Math.max(1, Math.floor(delta / 60_000))} мин назад`;
  if (delta < 86_400_000) return `${Math.max(1, Math.floor(delta / 3_600_000))} ч назад`;
  if (delta < 172_800_000) return "вчера";
  return `${Math.max(1, Math.floor(delta / 86_400_000))} дн назад`;
}

// Текст заметки и время разделены: время не имеет права уехать в многоточие,
// оно и есть сигнал. Обрезается только сам текст, и только с конца.
function activityLabel(activity: BoardCard["last_activity"]) {
  if (!activity?.at) return { text: "Активность пока не зафиксирована", at: "" };
  const kind = activity.kind === "call" ? "Звонок" : activity.kind === "stage" ? "Этап" : "Заметка";
  const detail = activity.kind === "note" && activity.text ? `: ${activity.text}` : "";
  return { text: `${kind}${detail}`, at: relative(activity.at) };
}

function LastActivity({ text, at }: { text: string; at: string }) {
  return (
    <span className="last-activity" title={at ? `${text} · ${at}` : text}>
      <span className="last-activity-text">{text}</span>
      {at && <span className="last-activity-at">{at}</span>}
    </span>
  );
}

function amount(value: number | null, currency: string) {
  if (value === null) return null;
  return `${currency || "€"} ${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value)}`;
}

function textAmount(value: string | null) {
  if (!value?.trim()) return null;
  return value.includes("€") ? value.trim() : `€ ${value.trim()}`;
}

function channelIcon(source: string | null) {
  if (!source) return <Globe size={14} aria-hidden="true" />;
  if (/звон|call|phone/i.test(source)) return <Phone size={14} aria-hidden="true" />;
  return <MessageCircle size={14} aria-hidden="true" />;
}

function cardMoney(deal: BoardCard) {
  const price = amount(deal.budget, deal.budget_currency);
  if (price) return price;
  const monthly = textAmount(deal.monthly_payment_text);
  const down = textAmount(deal.down_payment_text);
  if (!monthly && !down) return null;
  return [monthly && `${monthly} / мес`, down && `взнос ${down}`].filter(Boolean).join(" · ");
}

function isOverdue(deal: BoardCard) {
  return Boolean(deal.next_task && new Date(deal.next_task.due_at).getTime() < Date.now());
}

function PresentationalCard({
  deal,
  dragging = false,
  onOpen,
}: {
  deal: BoardCard;
  dragging?: boolean;
  onOpen?: () => void;
}) {
  const overdue = isOverdue(deal);
  const noNextStep = !deal.next_task && deal.status === "open";
  return (
    <article
      className={`deal-card ${overdue ? "deal-card-overdue" : ""} ${dragging ? "deal-card-overlay" : ""}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen?.();
        }
      }}
      role={onOpen ? "link" : undefined}
      tabIndex={onOpen ? 0 : undefined}
    >
      <div className="deal-title">
        <span>{deal.contact_name || deal.phone}</span>
        {deal.source_name && <span className="deal-channel" title={deal.source_name}>
          {channelIcon(deal.source_name)}
          <span>{deal.source_name}</span>
        </span>}
      </div>
      {deal.object_text && <div className="deal-object">
        <House size={14} aria-hidden="true" />
        <span>{deal.object_text}</span>
      </div>}
      {(deal.projects.length > 0 || deal.tags.length > 0) && <div className="deal-tags">
        {deal.projects.map((project) => (
          <span className={`tag ${project.code === "select" ? "tag-select" : project.code === "next" ? "tag-next" : "tag-grey"}`} key={project.id ?? project.name}>{project.name}</span>
        ))}
        {deal.tags.map((tag) => <span className="tag tag-grey" key={tag.id ?? tag.name}>{tag.name}</span>)}
      </div>}
      {cardMoney(deal) && <div className="deal-money">{cardMoney(deal)}</div>}
      <div className="deal-footer">
        <span className="owner-mark">
          <span className="avatar">{deal.owner_name ? initials(deal.owner_name) : "—"}</span>
          {noNextStep && <span className="no-step-dot" title="Следующий шаг не назначен" />}
        </span>
        {overdue && <span className="task-state overdue">Просрочено</span>}
        <LastActivity {...activityLabel(deal.last_activity)} />
      </div>
    </article>
  );
}

function DraggableCard({ deal, onOpen }: { deal: BoardCard; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: deal.id });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={isDragging ? "deal-card-dragging" : ""}>
      <PresentationalCard deal={deal} onOpen={onOpen} />
    </div>
  );
}

function KettleCard({ deal, onOpen, onClaim }: { deal: BoardCard; onOpen: () => void; onClaim: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: deal.id });
  return (
    <article ref={setNodeRef} {...listeners} {...attributes} className={`kettle-card ${isDragging ? "deal-card-dragging" : ""}`} onClick={onOpen}>
      <div className="kettle-meta">{deal.source_name && channelIcon(deal.source_name)} {deal.source_name && <span>{deal.source_name} · </span>}{time(deal.updated_at)}</div>
      <strong>{deal.contact_name || deal.phone}</strong>
      {(deal.title || deal.object_text) && <p>{deal.title || deal.object_text}</p>}
      <div className="kettle-footer"><span>ждёт {relative(deal.updated_at)}</span><button className="btn kettle-claim" type="button" onClick={(event) => { event.stopPropagation(); onClaim(); }}>Взять</button></div>
    </article>
  );
}

function BoardColumn({
  column,
  onOpen,
  onCreate,
  onClaim,
  onToggle,
}: {
  column: BoardColumn;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onClaim: (id: string) => void;
  onToggle?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const [menuOpen, setMenuOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  if (hidden) return <button className="hidden-column" type="button" onClick={() => setHidden(false)}>Показать «{column.title}»</button>;
  return (
    <section ref={setNodeRef} className={`${column.kettle ? "kettle" : "kanban-column"} ${isOver ? "drop-target" : ""}`}>
      <div className="column-head">
        {onToggle && <button className="column-collapse" type="button" onClick={onToggle} aria-label="Развернуть колонку"><ChevronRight size={14} /></button>}
        <span className={`dot ${column.kettle ? "dot-amber" : column.won ? "dot-green" : "dot-blue"}`} />
        <strong>{column.title}</strong>
        <span className="pill">{column.total}</span>
        {!column.kettle && <div className="column-menu-wrap"><button className="column-more" type="button" aria-label={`Меню колонки ${column.title}`} onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal size={15} /></button>{menuOpen && <div className="column-menu"><button type="button" onClick={() => { setHidden(true); setMenuOpen(false); }}>Скрыть колонку</button></div>}</div>}
      </div>
      {column.sum !== null && column.sum > 0 && <div className="column-sum">€ {new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(column.sum)}</div>}
      {column.deals.map((deal) => column.kettle ? <KettleCard key={deal.id} deal={deal} onOpen={() => onOpen(deal.id)} onClaim={() => onClaim(deal.id)} /> : <DraggableCard key={deal.id} deal={deal} onOpen={() => onOpen(deal.id)} />)}
      {column.deals.length === 0 && <div className="empty-column">Нет сделок</div>}
      <button className="column-add-button" type="button" onClick={onCreate}><Plus size={14} /> Сделка</button>
    </section>
  );
}

function LostColumn({ column, expanded, onToggle, onOpen, onCreate }: { column: BoardColumn; expanded: boolean; onToggle: () => void; onOpen: (id: string) => void; onCreate: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: "lost" });
  if (!expanded) return <button ref={setNodeRef} className={`closed-column ${isOver ? "drop-target" : ""}`} type="button" onClick={onToggle} aria-label={`Развернуть Отказ: ${column.total}`}><ChevronRight size={14} /><span className="dot dot-grey" /><span className="closed-column-label">Отказ</span><span className="pill">{column.total}</span></button>;
  return <section ref={setNodeRef} className={`kanban-column lost-expanded ${isOver ? "drop-target" : ""}`}><div className="column-head"><button className="column-collapse" type="button" onClick={onToggle} aria-label="Свернуть Отказ"><ChevronDown size={14} /></button><span className="dot dot-grey" /><strong>{column.title}</strong><span className="pill">{column.total}</span></div>{column.deals.map((deal) => <DraggableCard key={deal.id} deal={deal} onOpen={() => onOpen(deal.id)} />)}{column.deals.length === 0 && <div className="empty-column">Нет отказов</div>}<button className="column-add-button" type="button" onClick={onCreate}><Plus size={14} /> Сделка</button></section>;
}

function GateDialog({ gate, form, setForm, props, pending, onCancel, onSubmit }: { gate: Gate; form: GateForm; setForm: Dispatch<SetStateAction<GateForm>>; props: Props; pending: boolean; onCancel: () => void; onSubmit: () => void }) {
  const body = gate.lost ? (
    <>
      <label>Причина<select value={form.reasonId} onChange={(event) => setForm({ ...form, reasonId: event.target.value })}><option value="">Выберите причину</option>{props.lostReasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.name}</option>)}</select></label>
      <label>Комментарий<textarea value={form.comment} onChange={(event) => setForm({ ...form, comment: event.target.value })} /></label>
    </>
  ) : (
    <>
      {gate.needsQualification && <div className="qual-options"><button type="button" className={form.qualification === "КВАЛ" ? "selected" : ""} onClick={() => setForm({ ...form, qualification: "КВАЛ" })}>Квалифицирован</button><button type="button" className={form.qualification === "неквал" ? "selected" : ""} onClick={() => setForm({ ...form, qualification: "неквал" })}>Не квалифицирован</button></div>}
      {gate.needsTask && <><label>Тип задачи<select value={form.taskTypeId} onChange={(event) => setForm({ ...form, taskTypeId: event.target.value })}>{props.taskTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label><label>Что сделать<input value={form.taskTitle} onChange={(event) => setForm({ ...form, taskTitle: event.target.value })} /></label><label>Дата и время<input type="datetime-local" value={form.taskDueAt} onChange={(event) => setForm({ ...form, taskDueAt: event.target.value })} /></label><label>Исполнитель<select value={form.taskAssigneeId} onChange={(event) => setForm({ ...form, taskAssigneeId: event.target.value })}>{props.activeAssignees.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label></>}
    </>
  );
  return <div className="gate-scrim motion-veil"><div className="gate-dialog motion-dialog" role="dialog" aria-modal="true"><header><div><h2>{gate.lost ? "Закрыть сделку как отказ" : gate.needsQualification ? "Клиент квалифицирован?" : "Нужен следующий шаг"}</h2><p>{gate.lost ? "Укажите причину — история сделки сохранится." : gate.needsQualification ? "Отмечайте после разговора — это видно всему отделу." : `Сделка не перейдёт в ${gate.target.title}, пока не назначен следующий шаг.`}</p></div><button className="gate-close" type="button" onClick={onCancel} aria-label="Закрыть"><X size={16} /></button></header>{body}<footer><button className="btn" type="button" onClick={onCancel} disabled={pending}>Отмена <kbd>Esc</kbd></button><button className="gate-primary" type="button" onClick={onSubmit} disabled={pending}>{gate.lost ? "Закрыть как отказ" : gate.needsTask ? "Поставить задачу и перевести" : "Перевести"} <kbd>↵</kbd></button></footer></div></div>;
}

export function DealsBoard(props: Props) {
  const router = useRouter();
  const [columns, setColumns] = useState<BoardColumn[]>(() => props.lost ? [...props.columns, props.lost] : props.columns);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [lostExpanded, setLostExpanded] = useState(false);
  const [gate, setGate] = useState<Gate | null>(null);
  const [mobileConfirmation, setMobileConfirmation] = useState<MobileConfirmation | null>(null);
  const [gateForm, setGateForm] = useState<GateForm>({ qualification: "", reasonId: "", comment: "", taskTitle: "", taskDueAt: "", taskTypeId: props.taskTypes[0]?.id ?? "", taskAssigneeId: props.currentUserId });
  const lastDragAt = useRef(0);
  const maps = useMemo(() => new Map(columns.flatMap((column) => column.deals).map((deal) => [deal.id, deal])), [columns]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const collisionDetectionStrategy = (args: Parameters<typeof pointerWithin>[0]) => args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args);
  useEffect(() => { if (!feedback) return; const timer = window.setTimeout(() => setFeedback(null), 2800); return () => window.clearTimeout(timer); }, [feedback]);
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !pending) { setGate(null); setMobileConfirmation(null); } }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [pending]);
  const openDeal = (id: string) => { if (Date.now() - lastDragAt.current > 300) router.push(`/deals/${id}`); };
  const createDeal = () => window.dispatchEvent(new CustomEvent("crm:create-deal-open"));
  const activeDeal = activeId ? maps.get(activeId) : null;
  function onDragStart(event: DragStartEvent) { if (!pending) { lastDragAt.current = Date.now(); setActiveId(String(event.active.id)); setFeedback(null); } }
  function onDragCancel() { lastDragAt.current = Date.now(); setActiveId(null); }
  async function commitGate() {
    if (!gate || (gate.lost && !gateForm.reasonId) || (gate.needsQualification && !gateForm.qualification) || (gate.needsTask && (!gateForm.taskTitle.trim() || !gateForm.taskDueAt || !gateForm.taskTypeId || !gateForm.taskAssigneeId))) { setFeedback("Заполните обязательные поля гейта"); return; }
    const taskDueAt = gate.needsTask ? new Date(gateForm.taskDueAt) : null;
    if (taskDueAt && (!Number.isFinite(taskDueAt.getTime()) || taskDueAt.getTime() <= Date.now())) { setFeedback("Дата следующего шага должна быть в будущем"); return; }
    setPending(true);
    const result = await createClient().rpc("transition_crm_deal", { p_deal_id: gate.deal.id, p_stage_id: gate.target.id, p_owner_id: gate.lost ? gate.deal.owner_id : gate.deal.owner_id ?? props.currentUserId, p_lost_reason_id: gate.lost ? gateForm.reasonId : null, p_lost_comment: gate.lost ? gateForm.comment || null : null, p_qualification: gateForm.qualification || null, p_task_title: gate.needsTask ? gateForm.taskTitle.trim() : null, p_task_due_at: gate.needsTask ? taskDueAt?.toISOString() ?? null : null, p_task_type_id: gate.needsTask ? gateForm.taskTypeId : null, p_task_assignee_id: gate.needsTask ? gateForm.taskAssigneeId : null });
    if (result.error || !result.data) { setFeedback(result.error?.message ?? "Сделка недоступна"); setPending(false); return; }
    const transition = result.data as { stage_id: string; owner_id: string | null; status: BoardCard["status"] };
    const confirmed = { ...gate.deal, stage_id: transition.stage_id, owner_id: transition.owner_id, status: transition.status, next_task: gate.needsTask && taskDueAt ? { title: gateForm.taskTitle.trim(), due_at: taskDueAt.toISOString() } : gate.deal.next_task };
    setColumns((current) => { const removed = current.map((column) => column.id === (gate.deal.stage_id || "kettle") || column.deals.some((item) => item.id === gate.deal.id) ? { ...column, total: column.deals.some((item) => item.id === gate.deal.id) ? Math.max(0, column.total - 1) : column.total, deals: column.deals.filter((item) => item.id !== gate.deal.id) } : column); if (gate.lost) return removed.map((column) => column.id === "lost" ? { ...column, total: column.total + 1, deals: [confirmed, ...column.deals] } : column); return removed.map((column) => column.id === gate.target.id ? { ...column, total: column.total + 1, deals: [confirmed, ...column.deals] } : column); });
    setGate(null); setPending(false); setFeedback("Сделка перемещена");
  }
  async function moveDeal(dealId: string, targetId: string, allowMobileConfirmation = false) {
    if (pending) return;
    const sourceIndex = columns.findIndex((column) => column.deals.some((deal) => deal.id === dealId));
    const targetIndex = columns.findIndex((column) => column.id === targetId);
    const droppingLost = targetId === "lost" && props.lost !== null;
    if (sourceIndex < 0 || (!droppingLost && targetIndex < 0) || (!droppingLost && sourceIndex === targetIndex)) return;
    const source = columns[sourceIndex];
    const target = droppingLost ? (columns.find((column) => column.id === "lost") ?? props.lost!) : columns[targetIndex];
    const deal = source.deals.find((item) => item.id === dealId);
    if (!deal) return;
    const factualSource = columns.find((column) => column.id === deal.stage_id);
    const isForward = !droppingLost && (target.position ?? 0) > (factualSource?.position ?? 0);
    const needsQualification = !droppingLost && isForward && target.kind === "open" && target.requires_qualification_tag === true && !deal.tags.some((tag) => tag.name === "КВАЛ" || tag.name === "неквал");
    const needsTask = !droppingLost && isForward && target.kind === "open" && target.requires_next_step === true && !deal.next_task;
    if (droppingLost || needsQualification || needsTask) {
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(10, 0, 0, 0);
      setGate({ deal, target, sourceIndex, targetIndex: droppingLost ? -1 : targetIndex, lost: droppingLost, needsQualification, needsTask });
      setGateForm((current) => ({ ...current, qualification: "", reasonId: "", comment: "", taskTitle: "", taskDueAt: needsTask ? new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "", taskTypeId: props.taskTypes[0]?.id ?? "", taskAssigneeId: deal.owner_id ?? props.currentUserId }));
      return;
    }
    if (window.innerWidth <= 600 && !allowMobileConfirmation) { setMobileConfirmation({ dealId, targetId, destination: target.kettle ? "Общий котёл" : target.title }); return; }
    const targetStage = target.kettle ? (deal.status === "won" ? columns.find((column) => column.kind === "open") ?? target : target) : target;
    const update: Partial<BoardCard> = target.kettle ? { owner_id: null } : { stage_id: targetStage.id, owner_id: deal.owner_id ?? props.currentUserId };
    const nextDeal = { ...deal, ...update };
    const snapshot = columns;
    setColumns(columns.map((column) => column.id === source.id ? { ...column, total: column.total - 1, deals: column.deals.filter((item) => item.id !== dealId) } : column.id === target.id ? { ...column, total: column.total + 1, deals: [nextDeal, ...column.deals] } : column));
    setPending(true);
    const result = await createClient().rpc("transition_crm_deal", { p_deal_id: dealId, p_stage_id: target.kettle ? (deal.status === "won" ? targetStage.id : deal.stage_id) : target.id, p_owner_id: target.kettle ? null : nextDeal.owner_id, p_lost_reason_id: null, p_lost_comment: null, p_qualification: null, p_task_title: null, p_task_due_at: null, p_task_type_id: null, p_task_assignee_id: null });
    if (result.error || !result.data) { setColumns(snapshot); setFeedback(result.error?.message ?? "Сделка не найдена или недоступна"); setPending(false); return; }
    setPending(false); setFeedback("Сделка перемещена");
  }
  function claimDeal(dealId: string) { const firstOpen = columns.find((column) => column.kind === "open"); if (firstOpen) void moveDeal(dealId, firstOpen.id, true); }
  function onDragEnd(event: DragEndEvent) { lastDragAt.current = Date.now(); setActiveId(null); const targetId = event.over?.id ? String(event.over.id) : null; if (targetId) void moveDeal(String(event.active.id), targetId); }
  const visibleColumns = columns.filter((column) => column.id !== "lost");
  const lost = columns.find((column) => column.id === "lost");
  return <>
    <DndContext id="crm-deals-board" sensors={sensors} collisionDetection={collisionDetectionStrategy} onDragStart={onDragStart} onDragCancel={onDragCancel} onDragEnd={onDragEnd}>
      <div className="board">
        {visibleColumns.map((column) => <BoardColumn key={column.id} column={column} onOpen={openDeal} onCreate={createDeal} onClaim={claimDeal} />)}
        {lost && <LostColumn column={lost} expanded={lostExpanded} onToggle={() => setLostExpanded((expanded) => !expanded)} onOpen={openDeal} onCreate={createDeal} />}
      </div>
      <DragOverlay>{activeDeal ? <PresentationalCard deal={activeDeal} dragging /> : null}</DragOverlay>
    </DndContext>
    {feedback && <div className="dnd-feedback" role="status">{feedback}</div>}
    {gate && <GateDialog gate={gate} form={gateForm} setForm={setGateForm} props={props} pending={pending} onCancel={() => setGate(null)} onSubmit={commitGate} />}
    {mobileConfirmation && <div className="gate-scrim motion-veil"><div className="gate-dialog motion-dialog move-confirmation" role="dialog" aria-modal="true"><header><div><h2>Подтвердить перенос</h2><p>Переместить сделку в «{mobileConfirmation.destination}»?</p></div><button className="gate-close" type="button" onClick={() => setMobileConfirmation(null)} aria-label="Закрыть"><X size={16} /></button></header><footer><button className="btn" type="button" onClick={() => setMobileConfirmation(null)} disabled={pending}>Отмена <kbd>Esc</kbd></button><button className="gate-primary" type="button" onClick={() => { const confirmation = mobileConfirmation; setMobileConfirmation(null); void moveDeal(confirmation.dealId, confirmation.targetId, true); }} disabled={pending}>Перевести <kbd>↵</kbd></button></footer></div></div>}
  </>;
}
