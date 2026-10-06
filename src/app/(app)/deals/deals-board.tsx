"use client";

import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  ChevronDown,
  ChevronRight,
  House,
  MoreHorizontal,
  Plus,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { StageIndicator } from "@/components/crm/stage-indicator";
import { monthlyAmount, shortAmount } from "@/lib/amo-amount";
import { StageGateDialog } from "@/components/crm/stage-gate-dialog";
import { createClient } from "@/lib/supabase/client";
import { dbErrorText } from "@/lib/db-errors";
import { initialsOf } from "@/lib/initials";
import { closeOpenTasks, emptyGateForm, loadGateSnapshot, planGate, targetHasGates, tomorrowMorning, transitionDeal, transitionErrorText, unqualifiedBlocks, type GateForm, type GatePlan, type GateStage } from "@/lib/stage-gate";
import { startRouteProgress } from "../route-progress";
import { useDismiss } from "@/lib/use-dismiss";
import { SourceIcon } from "@/components/crm/source-icon";
import { PostponedChip, SlaChip, slaRowClass } from "./sla-chip";

type OpenEvent = { metaKey: boolean; ctrlKey: boolean; button: number };
type OpenDeal = (event?: OpenEvent) => void;

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
  // Срок первого ответа и остаток в рабочих минутах; приходят, только пока ответа не было.
  sla_due_at?: string | null;
  sla_left_min?: number | null;
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
  requires_qualification?: boolean;
};
type Option = { id: string; name: string };
type Props = {
  columns: BoardColumn[];
  lost: BoardColumn | null;
  currentUserId: string;
  lostReasons: Option[];
  taskTypes: Option[];
  activeAssignees: Option[];
  query: BoardQuery;
};
export type BoardQuery = {
  pageSize: number;
  owner: string | null;
  project: string | null;
  tags: string[] | null;
  createdFrom: string | null;
  createdTo: string | null;
  source: string | null;
  flag: "no_next_step" | "overdue" | "today" | null;
  sort: string;
  lostKey: string | null;
};
type Gate = {
  deal: BoardCard;
  target: BoardColumn;
  stage: GateStage;
  plan: GatePlan;
};
type MobileConfirmation = { dealId: string; targetId: string; destination: string };

// Для колонки «Отказ» id колонки — "lost", а этап в базе — lostKey.
function stageOf(column: BoardColumn, lostKey: string | null): GateStage {
  return { id: column.id === "lost" ? lostKey ?? column.id : column.id, name: column.title, kind: column.kind ?? "open", position: column.position ?? 0, requires_next_step: column.requires_next_step, requires_qualification_tag: column.requires_qualification_tag, requires_qualification: column.requires_qualification };
}

// Колонка знает свой итог и сумму бюджетов целиком (с сервера), а карточки
// подгружаются порциями. Поэтому перенос правит обе цифры на месте, не дожидаясь
// нового запроса.
function addDeal(column: BoardColumn, deal: BoardCard): BoardColumn {
  const budget = deal.budget ?? 0;
  return { ...column, total: column.total + 1, sum: budget > 0 ? (column.sum ?? 0) + budget : column.sum, deals: [deal, ...column.deals] };
}

function dropDeal(column: BoardColumn, deal: BoardCard): BoardColumn {
  const budget = deal.budget ?? 0;
  return { ...column, total: Math.max(0, column.total - 1), sum: column.sum === null ? null : Math.max(0, column.sum - budget), deals: column.deals.filter((item) => item.id !== deal.id) };
}

function time(value: string) {
  return new Date(value).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Chisinau" });
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
  const kind =
    activity.kind === "call" ? "Звонок"
    : activity.kind === "stage" ? "Этап изменён"
    : activity.kind === "created" ? "Сделка создана"
    : "Заметка";
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

function cardMoney(deal: BoardCard) {
  const price = amount(deal.budget, deal.budget_currency);
  if (price) return price;
  const monthly = monthlyAmount(deal.monthly_payment_text);
  const down = shortAmount(deal.down_payment_text);
  if (!monthly && !down) return null;
  return [monthly, down && `взнос ${down}`].filter(Boolean).join(" · ");
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
  onOpen?: OpenDeal;
}) {
  const overdue = isOverdue(deal);
  const noNextStep = !deal.next_task && deal.status === "open";
  return (
    <article
      className={`deal-card ${overdue ? "deal-card-overdue" : ""} ${dragging ? "deal-card-overlay" : ""}`}
      onClick={(event) => onOpen?.(event)}
      // Карточка — не ссылка, а перетаскиваемый блок, поэтому Cmd-клик и клик
      // колесом браузер сам не обработает. Открыть сделку в соседней вкладке,
      // не теряя воронку из виду, в CRM нужно каждый день.
      onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); onOpen?.(event); } }}
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
        {deal.source_name && <SourceIcon className="deal-channel" source={deal.source_name} />}
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
      {(deal.sla_due_at && deal.sla_left_min != null || deal.status === "postponed" && deal.postponed_until) && <div className={slaRowClass}>
        {deal.sla_due_at && deal.sla_left_min != null && <SlaChip dueAt={deal.sla_due_at} leftMin={deal.sla_left_min} />}
        {deal.status === "postponed" && deal.postponed_until && <PostponedChip until={deal.postponed_until} />}
      </div>}
      <div className="deal-footer">
        <span className="owner-mark">
          <span className="avatar">{deal.owner_name ? initialsOf(deal.owner_name) : "—"}</span>
          {noNextStep && <span className="no-step-dot" title="Следующий шаг не назначен" />}
        </span>
        {overdue && <span className="task-state overdue">Просрочено</span>}
        <LastActivity {...activityLabel(deal.last_activity)} />
      </div>
    </article>
  );
}

function DraggableCard({ deal, onOpen, index = 0 }: { deal: BoardCard; onOpen: OpenDeal; index?: number }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: deal.id });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={isDragging ? "deal-card-dragging" : ""} style={{ "--i": index } as CSSProperties}>
      <PresentationalCard deal={deal} onOpen={onOpen} />
    </div>
  );
}

function KettleCard({ deal, onOpen, onClaim, index = 0 }: { deal: BoardCard; onOpen: OpenDeal; onClaim: () => void; index?: number }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: deal.id });
  return (
    <article ref={setNodeRef} {...listeners} {...attributes} className={`kettle-card ${isDragging ? "deal-card-dragging" : ""}`} style={{ "--i": index } as CSSProperties} onClick={(event) => onOpen(event)} onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); onOpen(event); } }}>
      <div className="kettle-meta">{deal.source_name && <SourceIcon source={deal.source_name} />}<span>{time(deal.updated_at)}</span></div>
      <strong>{deal.contact_name || deal.phone}</strong>
      {(deal.title || deal.object_text) && <p>{deal.title || deal.object_text}</p>}
      <div className="kettle-footer">{deal.sla_due_at && deal.sla_left_min != null ? <SlaChip dueAt={deal.sla_due_at} leftMin={deal.sla_left_min} /> : <span>ждёт {relative(deal.updated_at)}</span>}<button className="btn kettle-claim" type="button" onClick={(event) => { event.stopPropagation(); onClaim(); }}>Взять</button></div>
    </article>
  );
}

// Хвост колонки: когда он въезжает в видимую область, догружается следующая
// порция. Кнопка остаётся только на случай ошибки — повторить руками.
function ColumnTail({ total, shown, loading, failed, onMore }: { total: number; shown: number; loading: boolean; failed: boolean; onMore: () => void }) {
  const sentinel = useRef<HTMLDivElement>(null);
  const latest = useRef(onMore);
  useEffect(() => { latest.current = onMore; });
  const more = shown < total;
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !more || failed || loading || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) latest.current(); }, { root: node.closest(".column-track"), rootMargin: "0px 0px 240px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [more, failed, loading, shown]);
  if (!more) return null;
  if (failed) return <button className="btn-ghost column-show-more" type="button" onClick={onMore}>Не загрузилось. Повторить</button>;
  return <div ref={sentinel} className="column-tail" aria-live="polite">{loading ? "Загрузка…" : `Ещё ${total - shown}`}</div>;
}

// Клиентская навигация по счётчикам идёт через кэш роутера (staleTimes.dynamic),
// поэтому URL и чип могут обновиться, а серверные данные доски — нет.
// Guard сверяет флаг в URL с флагом, под который сервер собрал доску,
// и при расхождении дёргает refresh: повторный проход уже свежий, цикла нет.
const KNOWN_FLAGS = ["no_next_step", "overdue", "today"];
export function BoardRefreshGuard({ serverFlag }: { serverFlag: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("flag") ?? "";
  const urlFlag = KNOWN_FLAGS.includes(raw) ? raw : "";
  useEffect(() => {
    if (urlFlag !== serverFlag) router.refresh();
  }, [urlFlag, serverFlag, router]);
  return null;
}

// Сумма бюджетов сделок колонки. Бюджет заполнен не у всех сделок, поэтому
// пустая сумма говорит об этом словами, а не пропадает.
function ColumnSum({ column }: { column: BoardColumn }) {
  if (column.sum !== null && column.sum > 0) return <div className="column-sum" title="Сумма бюджетов сделок этапа">€ {new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(column.sum)}</div>;
  if (column.kettle) return null;
  return <div className="column-sum is-empty">Бюджет не указан</div>;
}

function BoardColumn({
  column,
  stages,
  onOpen,
  onCreate,
  onClaim,
  onToggle,
  onShowMore,
  loadingMore,
  loadFailed,
}: {
  column: BoardColumn;
  stages: { id: string; kind: "open" | "won" | "lost"; position: number }[];
  onOpen: (id: string, event?: OpenEvent) => void;
  onCreate: () => void;
  onClaim: (id: string) => void;
  onToggle?: () => void;
  onShowMore: (columnId: string) => void;
  loadingMore: boolean;
  loadFailed: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(menuRef, menuOpen, () => setMenuOpen(false));
  const [hidden, setHidden] = useState(false);
  if (hidden) return <button className="hidden-column" type="button" onClick={() => setHidden(false)}>Показать «{column.title}»</button>;
  return (
    <section ref={setNodeRef} className={`${column.kettle ? "kettle" : "kanban-column"} ${isOver ? "drop-target" : ""}`}>
      <div className="column-head">
        {onToggle && <button className="column-collapse" type="button" onClick={onToggle} aria-label="Развернуть колонку"><ChevronRight size={14} /></button>}
        {column.kettle
          ? <StageIndicator hue="grey" name={column.title} />
          : <StageIndicator stage={{ id: column.id, kind: column.kind ?? (column.won ? "won" : "open"), position: column.position ?? 0 }} stages={stages} name={column.title} />}
        <span className="pill">{column.total}</span>
        {!column.kettle && <div className="column-menu-wrap" ref={menuRef}><button className="column-more" type="button" aria-label={`Меню колонки ${column.title}`} onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal size={15} /></button>{menuOpen && <div className="column-menu"><button type="button" onClick={() => { setHidden(true); setMenuOpen(false); }}>Скрыть колонку</button></div>}</div>}
      </div>
      <ColumnSum column={column} />
      <div className="column-track motion-list">
      {column.deals.map((deal, index) => column.kettle ? <KettleCard key={deal.id} deal={deal} index={index} onOpen={(event) => onOpen(deal.id, event)} onClaim={() => onClaim(deal.id)} /> : <DraggableCard key={deal.id} deal={deal} index={index} onOpen={(event) => onOpen(deal.id, event)} />)}
      {column.deals.length === 0 && <div className="empty-column">Нет сделок</div>}
      <ColumnTail total={column.total} shown={column.deals.length} loading={loadingMore} failed={loadFailed} onMore={() => onShowMore(column.id)} />
      <button className="column-add-button" type="button" onClick={onCreate}><Plus size={14} /> Сделка</button>
      </div>
    </section>
  );
}

function LostColumn({ column, stages, expanded, onToggle, onOpen, onCreate, onShowMore, loadingMore, loadFailed }: { column: BoardColumn; stages: { id: string; kind: "open" | "won" | "lost"; position: number }[]; expanded: boolean; onToggle: () => void; onOpen: (id: string, event?: OpenEvent) => void; onCreate: () => void; onShowMore: (columnId: string) => void; loadingMore: boolean; loadFailed: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: "lost" });
  if (!expanded) return <button ref={setNodeRef} className={`closed-column ${isOver ? "drop-target" : ""}`} type="button" onClick={onToggle} aria-label={`Развернуть Отказ: ${column.total}`}><ChevronRight size={14} /><StageIndicator variant="dot" stage={{ id: column.id, kind: "lost", position: column.position ?? 0 }} stages={stages} /><span className="closed-column-label">Отказ</span><span className="pill">{column.total}</span></button>;
  return <section ref={setNodeRef} className={`kanban-column lost-expanded ${isOver ? "drop-target" : ""}`}><div className="column-head"><button className="column-collapse" type="button" onClick={onToggle} aria-label="Свернуть Отказ"><ChevronDown size={14} /></button><StageIndicator stage={{ id: column.id, kind: "lost", position: column.position ?? 0 }} stages={stages} name={column.title} /><span className="pill">{column.total}</span></div><div className="column-track motion-list">{column.deals.map((deal, index) => <DraggableCard key={deal.id} deal={deal} index={index} onOpen={(event) => onOpen(deal.id, event)} />)}{column.deals.length === 0 && <div className="empty-column">Нет отказов</div>}<ColumnTail total={column.total} shown={column.deals.length} loading={loadingMore} failed={loadFailed} onMore={() => onShowMore(column.id)} /><button className="column-add-button" type="button" onClick={onCreate}><Plus size={14} /> Сделка</button></div></section>;
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
  const [gateForm, setGateForm] = useState<GateForm>(() => emptyGateForm(props.taskTypes[0]?.id ?? "", props.currentUserId));
  const [gateError, setGateError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState<Record<string, boolean>>({});
  const [loadFailed, setLoadFailed] = useState<Record<string, boolean>>({});
  const lastDragAt = useRef(0);
  const maps = useMemo(() => new Map(columns.flatMap((column) => column.deals).map((deal) => [deal.id, deal])), [columns]);
  const lostKey = props.query.lostKey;
  const gateStages = useMemo(() => columns.filter((column) => !column.kettle).map((column) => stageOf(column, lostKey)), [columns, lostKey]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  useEffect(() => { if (!feedback) return; const timer = window.setTimeout(() => setFeedback(null), 2800); return () => window.clearTimeout(timer); }, [feedback]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) { setGate(null); setMobileConfirmation(null); }
      // «Перевести ↵» в подтверждении переноса: Enter с кнопки сработает сам, с остального экрана — здесь.
      if (event.key === "Enter" && mobileConfirmation && !pending && !(event.target as HTMLElement | null)?.closest("button, a")) {
        event.preventDefault();
        setMobileConfirmation(null);
        void moveDeal(mobileConfirmation.dealId, mobileConfirmation.targetId, true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // moveDeal пересоздаётся на каждый рендер и читает свежее состояние через замыкание.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, mobileConfirmation, columns]);
  const openDeal = (id: string, event?: OpenEvent) => {
    if (Date.now() - lastDragAt.current <= 300) return;
    if (event && (event.metaKey || event.ctrlKey || event.button === 1)) { window.open(`/deals/${id}`, "_blank", "noopener"); return; }
    startRouteProgress();
    router.push(`/deals/${id}`);
  };
  const createDeal = () => window.dispatchEvent(new CustomEvent("crm:create-deal-open"));
  const activeDeal = activeId ? maps.get(activeId) : null;
  function onDragStart(event: DragStartEvent) { if (!pending) { lastDragAt.current = Date.now(); setActiveId(String(event.active.id)); setFeedback(null); } }
  function onDragCancel() { lastDragAt.current = Date.now(); setActiveId(null); }
  async function commitGate() {
    if (!gate || pending) return;
    const { plan } = gate;
    if (plan.blocked || plan.missingFields.length) return;
    if ((plan.lost && !gateForm.reasonId) || (plan.needsQualification && !gateForm.qualification) || (plan.needsTask && (!gateForm.taskTitle.trim() || !gateForm.taskDueAt || !gateForm.taskTypeId || !gateForm.taskAssigneeId))) { setGateError("Заполните обязательные поля"); return; }
    if (plan.needsQualification && gateForm.qualification === "неквал" && unqualifiedBlocks(gate.stage, gateStages)) return;
    const taskDueAt = plan.needsTask ? new Date(gateForm.taskDueAt) : null;
    if (taskDueAt && (!Number.isFinite(taskDueAt.getTime()) || taskDueAt.getTime() <= Date.now())) { setGateError("Дата следующего шага должна быть в будущем"); return; }
    setPending(true); setGateError(null);
    try {
      const db = createClient();
      const result = await transitionDeal(db, { dealId: gate.deal.id, stageId: gate.stage.id, ownerId: plan.lost ? gate.deal.owner_id : gate.deal.owner_id ?? props.currentUserId, lostReasonId: plan.lost ? gateForm.reasonId : null, lostComment: plan.lost ? gateForm.comment : null, qualification: gateForm.qualification, task: plan.needsTask && taskDueAt ? { title: gateForm.taskTitle.trim(), dueAt: taskDueAt.toISOString(), typeId: gateForm.taskTypeId, assigneeId: gateForm.taskAssigneeId } : null });
      if (!result.ok) { setGateError(result.message); return; }
      // 200 без смены этапа — это не перенос: не рисуем сделку в новой колонке.
      if (result.data.stage_id !== gate.stage.id) { setGateError("Сервер не перенёс сделку на этот этап. Обновите страницу и повторите"); return; }
      // Отказ закрывает открытые задачи, пока менеджер не снял галочку. Число из снимка не ждём:
      // задачу могли поставить после того, как модалка прочитала сделку.
      let closedTasks = 0;
      let tasksClosed = false;
      if (plan.lost && gateForm.closeTasks) {
        const closed = await closeOpenTasks(db, gate.deal.id, props.currentUserId);
        closedTasks = closed.closed;
        tasksClosed = !closed.failed;
      }
      const transition = result.data;
      const qualificationTag = gateForm.qualification ? [{ name: gateForm.qualification }] : [];
      const confirmed: BoardCard = { ...gate.deal, stage_id: transition.stage_id, owner_id: transition.owner_id, status: transition.status as BoardCard["status"], tags: qualificationTag.length ? [...gate.deal.tags.filter((tag) => tag.name !== "КВАЛ" && tag.name !== "неквал"), ...qualificationTag] : gate.deal.tags, next_task: tasksClosed ? null : plan.needsTask && taskDueAt ? { title: gateForm.taskTitle.trim(), due_at: taskDueAt.toISOString() } : gate.deal.next_task };
      setColumns((current) => {
        const removed = current.map((column) => column.deals.some((item) => item.id === gate.deal.id) ? dropDeal(column, gate.deal) : column);
        const targetId = plan.lost ? "lost" : gate.target.id;
        return removed.map((column) => column.id === targetId ? addDeal(column, confirmed) : column);
      });
      // Счётчики над доской («Без следующего шага» и др.) считает сервер: после
      // перехода просим пересчитать, доска при этом остаётся как есть.
      router.refresh();
      setGate(null);
      setFeedback(plan.lost && gateForm.closeTasks && !tasksClosed ? "Сделка закрыта, но открытые задачи закрыть не удалось" : plan.lost && closedTasks > 0 ? `Сделка закрыта, задач закрыто: ${closedTasks}` : "Сделка перемещена");
    } catch (cause) {
      setGateError(transitionErrorText(cause));
    } finally {
      setPending(false);
    }
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
    // Сброс на «Отказ» сделки, которая на доске уже там, — не переход. Но доска могла устареть
    // (сделку вернули в другой вкладке): решает свежий этап из базы, он читается ниже.
    const droppedOnSameLost = droppingLost && (source.id === "lost" || deal.stage_id === props.query.lostKey);
    const factualSource = columns.find((column) => column.id === deal.stage_id);
    const isForward = !droppingLost && (target.position ?? 0) > (factualSource?.position ?? 0);
    const markedUnqualified = isForward && deal.tags.some((tag) => tag.name === "неквал");
    if (!target.kettle && (droppingLost || markedUnqualified || (isForward && targetHasGates(stageOf(target, props.query.lostKey))))) {
      // Метки, будущие задачи и пустые поля читаем свежими: карточка на доске могла устареть.
      setPending(true);
      const stage = stageOf(target, props.query.lostKey);
      try {
        const snapshot = await loadGateSnapshot(createClient(), dealId, stage.requires_qualification === true && !droppingLost);
        // Доска могла устареть (переход сделали в другой вкладке или карточка не обновилась):
        // сделка уже на целевом этапе — не открываем модалку, а выравниваем доску по базе.
        if (snapshot.stageId && snapshot.stageId !== deal.stage_id) {
          const actual = columns.find((column) => !column.kettle && stageOf(column, props.query.lostKey).id === snapshot.stageId);
          setColumns((current) => current.map((column) => column.deals.some((item) => item.id === dealId) ? dropDeal(column, deal) : column).map((column) => actual && column.id === actual.id ? addDeal(column, { ...deal, stage_id: snapshot.stageId as string, status: actual.kind === "lost" ? "lost" : actual.kind === "won" ? "won" : "open" }) : column));
          setFeedback(`Сделка уже на этапе «${actual?.title ?? "другом"}» — доска обновлена`);
          setPending(false);
          router.refresh();
          return;
        }
        // В базе сделка тоже в «Отказе»: сброс на ту же колонку ничего не меняет.
        if (droppedOnSameLost) { setPending(false); return; }
        const plan = planGate({ target: stage, source: factualSource ? stageOf(factualSource, props.query.lostKey) : undefined, stages: gateStages, snapshot, qualification: "" });
        if (plan.lost || plan.needsQualification || plan.needsTask || plan.missingFields.length > 0 || plan.blocked) {
          setGate({ deal, target, stage, plan });
          setGateError(null);
          setGateForm(() => ({ ...emptyGateForm(props.taskTypes[0]?.id ?? "", deal.owner_id ?? props.currentUserId), taskDueAt: plan.needsTask ? tomorrowMorning() : "" }));
          setPending(false);
          return;
        }
      } catch (cause) { setFeedback(dbErrorText(cause, "Не удалось проверить сделку. Попробуйте ещё раз")); setPending(false); return; }
      setPending(false);
    }
    if (window.innerWidth <= 600 && !allowMobileConfirmation) { setMobileConfirmation({ dealId, targetId, destination: target.kettle ? "Общий котёл" : target.title }); return; }
    const targetStage = target.kettle ? (deal.status === "won" ? columns.find((column) => column.kind === "open") ?? target : target) : target;
    const update: Partial<BoardCard> = target.kettle ? { owner_id: null } : { stage_id: targetStage.id, owner_id: deal.owner_id ?? props.currentUserId };
    const nextDeal = { ...deal, ...update };
    const snapshot = columns;
    setColumns(columns.map((column) => column.id === source.id ? dropDeal(column, deal) : column.id === target.id ? addDeal(column, nextDeal) : column));
    setPending(true);
    const result = await transitionDeal(createClient(), { dealId, stageId: target.kettle ? (deal.status === "won" ? targetStage.id : deal.stage_id) : target.id, ownerId: target.kettle ? null : nextDeal.owner_id });
    if (!result.ok) { setColumns(snapshot); setFeedback(result.message); setPending(false); return; }
    setPending(false); setFeedback("Сделка перемещена");
    router.refresh();
  }
  // Взять из котла — сменить ответственного, этап остаётся тот, что выбрали при создании.
  // Первая открытая колонка — только если колонки этапа сделки на доске нет или сделка выиграна.
  function claimDeal(dealId: string) {
    const deal = maps.get(dealId);
    const own = deal && deal.status !== "won" ? columns.find((column) => !column.kettle && column.kind === "open" && column.id === deal.stage_id) : undefined;
    const target = own ?? columns.find((column) => column.kind === "open");
    if (target) void moveDeal(dealId, target.id, true);
  }
  // Догрузка одной колонки: crm_board отдаёт страницу только нужной колонки
  // (p_column). Страница считается по числу уже загруженных карточек; повторы
  // из-за переносов между колонками отбрасываем по id. Ключ «Отказа» — id этапа, а не "lost".
  async function showMore(columnId: string) {
    const column = columns.find((item) => item.id === columnId);
    if (!column || loadingMore[columnId] || column.deals.length >= column.total) return;
    setLoadingMore((current) => ({ ...current, [columnId]: true }));
    setLoadFailed((current) => ({ ...current, [columnId]: false }));
    const key = columnId === "lost" ? (props.query.lostKey ?? "lost") : columnId;
    const result = await createClient().rpc("crm_board", {
      p_page: Math.floor(column.deals.length / props.query.pageSize),
      p_page_size: props.query.pageSize,
      p_owner: props.query.owner,
      p_project: props.query.project,
      p_tags: props.query.tags,
      p_created_from: props.query.createdFrom,
      p_created_to: props.query.createdTo,
      p_source: props.query.source,
      p_flag: props.query.flag,
      p_sort: props.query.sort,
      p_column: key,
    });
    setLoadingMore((current) => ({ ...current, [columnId]: false }));
    const payload = (!result.error && result.data ? result.data : null) as { columns: Record<string, { deals: BoardCard[] }> } | null;
    const fresh = payload?.columns[key]?.deals;
    const known = new Set(column.deals.map((deal) => deal.id));
    const added = fresh?.filter((deal) => !known.has(deal.id)) ?? [];
    // Пустой или целиком повторный ответ при незаполненной колонке — остановка,
    // иначе прокрутка запрашивала бы ту же страницу бесконечно.
    if (!fresh || added.length === 0) { setLoadFailed((current) => ({ ...current, [columnId]: true })); setFeedback("Не удалось загрузить сделки"); return; }
    setColumns((current) => current.map((item) => item.id === columnId ? { ...item, deals: [...item.deals, ...added.filter((deal) => !item.deals.some((existing) => existing.id === deal.id))] } : item));
  }
  function onDragEnd(event: DragEndEvent) { lastDragAt.current = Date.now(); setActiveId(null); const targetId = event.over?.id ? String(event.over.id) : null; if (targetId) void moveDeal(String(event.active.id), targetId); }
  const openDealFromGate = (id: string) => { setGate(null); startRouteProgress(); router.push(`/deals/${id}`); };
  const visibleColumns = columns.filter((column) => column.id !== "lost");
  const lost = columns.find((column) => column.id === "lost");
  const stageList = useMemo(
    () => columns.filter((column) => !column.kettle).map((column, index) => ({ id: column.id, kind: column.kind ?? (column.won ? "won" as const : "open" as const), position: column.position ?? index })),
    [columns],
  );
  return <>
    <DndContext id="crm-deals-board" sensors={sensors} collisionDetection={rectIntersection} onDragStart={onDragStart} onDragCancel={onDragCancel} onDragEnd={onDragEnd}>
      <div className="board">
        {visibleColumns.map((column) => <BoardColumn key={column.id} column={column} stages={stageList} onOpen={openDeal} onCreate={createDeal} onClaim={claimDeal} onShowMore={showMore} loadingMore={Boolean(loadingMore[column.id])} loadFailed={Boolean(loadFailed[column.id])} />)}
        {lost && <LostColumn column={lost} stages={stageList} expanded={lostExpanded} onToggle={() => setLostExpanded((expanded) => !expanded)} onOpen={openDeal} onCreate={createDeal} onShowMore={showMore} loadingMore={Boolean(loadingMore[lost.id])} loadFailed={Boolean(loadFailed[lost.id])} />}
      </div>
      <DragOverlay>{activeDeal ? <PresentationalCard deal={activeDeal} dragging /> : null}</DragOverlay>
    </DndContext>
    {feedback && <div className="dnd-feedback" role="status">{feedback}</div>}
    {gate && <StageGateDialog plan={gate.plan} target={gate.stage} stages={gateStages} form={gateForm} setForm={setGateForm} lostReasons={props.lostReasons} taskTypes={props.taskTypes} assignees={props.activeAssignees} pending={pending} error={gateError} onCancel={() => { setGate(null); setGateError(null); }} onSubmit={() => void commitGate()} onOpenDeal={() => openDealFromGate(gate.deal.id)} />}
    {mobileConfirmation && <div className="gate-scrim motion-veil"><div className="gate-dialog motion-dialog move-confirmation" role="dialog" aria-modal="true"><header><div><h2>Подтвердить перенос</h2><p>Переместить сделку в «{mobileConfirmation.destination}»?</p></div><button className="gate-close" type="button" onClick={() => setMobileConfirmation(null)} aria-label="Закрыть"><X size={16} /></button></header><footer><button className="btn" type="button" onClick={() => setMobileConfirmation(null)} disabled={pending}>Отмена <kbd>Esc</kbd></button><button className="gate-primary" type="button" onClick={() => { const confirmation = mobileConfirmation; setMobileConfirmation(null); void moveDeal(confirmation.dealId, confirmation.targetId, true); }} disabled={pending}>Перевести <kbd>↵</kbd></button></footer></div></div>}
  </>;
}
