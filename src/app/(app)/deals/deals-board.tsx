"use client";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { House, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Deal = {
  id: string;
  contact_id: string;
  owner_id: string | null;
  stage_id: string;
  status: "open" | "postponed" | "won" | "lost";
  object_text: string | null;
  source_id: string | null;
  budget: number | null;
  budget_currency: string;
  postponed_until: string | null;
};
type Contact = { id: string; full_name: string };
type Profile = { id: string; full_name: string };
type Source = { id: string; name: string };
type Project = { id: string; code: string; name: string };
type Tag = { id: string; name: string };
type Task = { deal_id: string; title: string; due_at: string };
type LostReason = { id: string; name: string };
type TaskType = { id: string; name: string };
type Column = {
  id: string;
  title: string;
  total: number;
  deals: Deal[];
  kettle?: boolean;
  won?: boolean;
  kind?: "open" | "won" | "lost";
  position?: number;
  requires_next_step?: boolean;
  requires_qualification_tag?: boolean;
};
type Props = {
  columns: Column[];
  lostCount: number;
  currentUserId: string;
  contacts: Contact[];
  owners: Profile[];
  sources: Source[];
  projects: Project[];
  tags: Tag[];
  projectLinks: { deal_id: string; project_id?: string }[];
  tagLinks: { deal_id: string; tag_id?: string }[];
  tasks: Task[];
  lostReasons: LostReason[];
  taskTypes: TaskType[];
  activeAssignees: Profile[];
  lostStageId: string | null;
  lostStageTitle: string;
};
type Gate = {
  deal: Deal;
  target: Column;
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
type Maps = {
  contacts: Map<string, Contact>;
  owners: Map<string, Profile>;
  sources: Map<string, Source>;
  projectsByDeal: Map<string, Project[]>;
  tagsByDeal: Map<string, Tag[]>;
  tasks: Map<string, Task>;
  now: number;
};
function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
function dateLabel(value: string) {
  return new Date(value).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
  });
}
function makeMaps(props: Props): Maps {
  const projectsByDeal = new Map<string, Project[]>();
  const tagsByDeal = new Map<string, Tag[]>();
  for (const link of props.projectLinks) {
    const item = props.projects.find(
      (project) => project.id === link.project_id,
    );
    if (item)
      projectsByDeal.set(link.deal_id, [
        ...(projectsByDeal.get(link.deal_id) ?? []),
        item,
      ]);
  }
  for (const link of props.tagLinks) {
    const item = props.tags.find((tag) => tag.id === link.tag_id);
    if (item)
      tagsByDeal.set(link.deal_id, [
        ...(tagsByDeal.get(link.deal_id) ?? []),
        item,
      ]);
  }
  const tasks = new Map<string, Task>();
  for (const task of [...props.tasks].sort(
    (a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime(),
  ))
    if (!tasks.has(task.deal_id)) tasks.set(task.deal_id, task);
  return {
    contacts: new Map(props.contacts.map((row) => [row.id, row])),
    owners: new Map(props.owners.map((row) => [row.id, row])),
    sources: new Map(props.sources.map((row) => [row.id, row])),
    projectsByDeal,
    tagsByDeal,
    tasks,
    now: Date.now(),
  };
}
function PresentationalCard({
  deal,
  maps,
  dragging = false,
}: {
  deal: Deal;
  maps: Maps;
  dragging?: boolean;
}) {
  const task = maps.tasks.get(deal.id);
  const due = task ? new Date(task.due_at).getTime() : 0;
  const step =
    deal.status === "postponed" && deal.postponed_until
      ? {
          text: `Отложена до ${dateLabel(deal.postponed_until)}`,
          tone: "postponed",
        }
      : deal.status === "open" && !task
        ? { text: "Нет следующего шага", tone: "warning" }
        : task && due < maps.now
          ? {
              text: `Просрочено ${Math.max(1, Math.ceil((maps.now - due) / 86400000))} дн`,
              tone: "danger",
            }
          : task
            ? { text: `Следующий шаг · ${dateLabel(task.due_at)}`, tone: "ok" }
            : null;
  const owner = deal.owner_id ? maps.owners.get(deal.owner_id) : undefined;
  const budget =
    deal.budget === null
      ? null
      : `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(deal.budget)} ${deal.budget_currency}`;
  return (
    <article
      className={`deal-card ${step?.tone === "warning" ? "deal-card-warning" : ""} ${dragging ? "deal-card-overlay" : ""}`}
    >
      <div className="deal-title">
        <span className="truncate">
          <Link className="deal-card-link" href={`/deals/${deal.id}`}>
            {maps.contacts.get(deal.contact_id)?.full_name ?? "Без имени"}
          </Link>
        </span>
        {deal.source_id && (
          <span className="deal-source">
            {maps.sources.get(deal.source_id)?.name}
          </span>
        )}
      </div>
      {deal.object_text && (
        <div className="deal-object">
          <House size={14} />
          <span className="truncate">{deal.object_text}</span>
        </div>
      )}
      {maps.projectsByDeal.get(deal.id)?.length ||
      maps.tagsByDeal.get(deal.id)?.length ? (
        <div className="deal-tags">
          {(maps.projectsByDeal.get(deal.id) ?? []).map((project) => (
            <span
              className={`tag ${project.code === "select" ? "tag-select" : "tag-next"}`}
              key={project.id}
            >
              {project.name}
            </span>
          ))}
          {(maps.tagsByDeal.get(deal.id) ?? []).map((tag) => (
            <span className="tag tag-grey" key={tag.id}>
              {tag.name}
            </span>
          ))}
        </div>
      ) : null}
      {budget && <div className="deal-money">Бюджет: {budget}</div>}
      <div className="deal-footer">
        <span className="avatar">
          {owner ? initials(owner.full_name) : "—"}
        </span>
        {step && <span className={`task-state ${step.tone}`}>{step.text}</span>}
      </div>
    </article>
  );
}
function DraggableCard({ deal, maps }: { deal: Deal; maps: Maps }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={isDragging ? "deal-card-dragging" : ""}
    >
      <PresentationalCard deal={deal} maps={maps} />
    </div>
  );
}
function BoardColumn({ column, maps }: { column: Column; maps: Maps }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  return (
    <section
      ref={setNodeRef}
      className={`${column.kettle ? "kettle" : "kanban-column"} ${isOver ? "drop-target" : ""}`}
    >
      <div className="column-head">
        <span
          className={`dot ${column.kettle ? "dot-amber" : column.won ? "dot-green" : "dot-blue"}`}
        />
        <strong>{column.title}</strong>
        <span className="pill">{column.total}</span>
        {!column.kettle && <MoreHorizontal size={15} className="column-more" />}
      </div>
      {column.deals.map((deal) => (
        <DraggableCard key={deal.id} deal={deal} maps={maps} />
      ))}
    </section>
  );
}
function LostDropZone({ count, enabled }: { count: number; enabled: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: "lost", disabled: !enabled });
  return (
    <section ref={setNodeRef} className={`closed-column ${isOver ? "drop-target" : ""}`} aria-label={`Отказ: ${count}`}>
      <span className="dot dot-grey" />
      <span className="closed-column-label">Отказ</span>
      <span className="pill">{count}</span>
    </section>
  );
}
function GateDialog({
  gate,
  form,
  setForm,
  props,
  pending,
  onCancel,
  onSubmit,
}: {
  gate: Gate;
  form: GateForm;
  setForm: React.Dispatch<React.SetStateAction<GateForm>>;
  props: Props;
  pending: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="gate-scrim">
      <div className="gate-dialog" role="dialog" aria-modal="true">
        <header>
          <div>
            <h2>{gate.lost ? "Закрыть сделку как отказ" : gate.needsQualification ? "Клиент квалифицирован?" : "Нужен следующий шаг"}</h2>
            <p>{gate.lost ? "Укажите причину — история сделки сохранится." : gate.needsQualification ? "Отмечайте после разговора — это видно всему отделу." : `Сделка не перейдёт в ${gate.target.title}, пока не назначен следующий шаг.`}</p>
          </div>
          <button className="gate-close" onClick={onCancel} aria-label="Закрыть">×</button>
        </header>
        {gate.lost ? (
          <>
            <label>Причина<select value={form.reasonId} onChange={(event) => setForm({ ...form, reasonId: event.target.value })}><option value="">Выберите причину</option>{props.lostReasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.name}</option>)}</select></label>
            <label>Комментарий<textarea value={form.comment} onChange={(event) => setForm({ ...form, comment: event.target.value })} /></label>
          </>
        ) : (
          <>
            {gate.needsQualification && <div className="qual-options"><button className={form.qualification === "КВАЛ" ? "selected" : ""} onClick={() => setForm({ ...form, qualification: "КВАЛ" })}>Квалифицирован</button><button className={form.qualification === "неквал" ? "selected" : ""} onClick={() => setForm({ ...form, qualification: "неквал" })}>Не квалифицирован</button></div>}
            {gate.needsTask && <><label>Тип задачи<select value={form.taskTypeId} onChange={(event) => setForm({ ...form, taskTypeId: event.target.value })}>{props.taskTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label><label>Что сделать<input value={form.taskTitle} onChange={(event) => setForm({ ...form, taskTitle: event.target.value })} /></label><label>Дата и время<input type="datetime-local" value={form.taskDueAt} onChange={(event) => setForm({ ...form, taskDueAt: event.target.value })} /></label><label>Исполнитель<select value={form.taskAssigneeId} onChange={(event) => setForm({ ...form, taskAssigneeId: event.target.value })}>{props.activeAssignees.map((person) => <option key={person.id} value={person.id}>{person.full_name}</option>)}</select></label></>}
          </>
        )}
        <footer><button className="btn" onClick={onCancel} disabled={pending}>Отмена <kbd>Esc</kbd></button><button className="gate-primary" onClick={onSubmit} disabled={pending}>{gate.lost ? "Закрыть как отказ" : "Перевести"} <kbd>↵</kbd></button></footer>
      </div>
    </div>
  );
}
export function DealsBoard(props: Props) {
  const [columns, setColumns] = useState(props.columns);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [gate, setGate] = useState<Gate | null>(null);
  const [gateForm, setGateForm] = useState<GateForm>({
    qualification: "",
    reasonId: "",
    comment: "",
    taskTitle: "",
    taskDueAt: "",
    taskTypeId: props.taskTypes[0]?.id ?? "",
    taskAssigneeId: props.currentUserId,
  });
  const maps = useMemo(() => makeMaps(props), [props]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  useEffect(() => {
    if (!feedback) return;
    const timeout = window.setTimeout(() => setFeedback(null), 2800);
    return () => window.clearTimeout(timeout);
  }, [feedback]);
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && gate && !pending) setGate(null);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [gate, pending]);
  const activeDeal = columns
    .flatMap((column) => column.deals)
    .find((deal) => deal.id === activeId);
  function onDragStart(event: DragStartEvent) {
    if (!pending) {
      setActiveId(String(event.active.id));
      setFeedback(null);
    }
  }
  function onDragCancel() {
    setActiveId(null);
  }
  async function commitGate() {
    if (!gate || (gate.lost && !gateForm.reasonId)) return;
    if (gate.needsQualification && !gateForm.qualification) return;
    if (
      gate.needsTask &&
      (!gateForm.taskTitle || !gateForm.taskDueAt || !gateForm.taskTypeId || !gateForm.taskAssigneeId)
    ) return;
    setPending(true);
    const ownerId = gate.lost
      ? gate.deal.owner_id
      : gate.deal.owner_id ?? props.currentUserId;
    const result = await createClient().rpc("transition_crm_deal", {
      p_deal_id: gate.deal.id,
      p_stage_id: gate.target.id,
      p_owner_id: ownerId,
      p_lost_reason_id: gate.lost ? gateForm.reasonId : null,
      p_lost_comment: gate.lost ? gateForm.comment || null : null,
      p_qualification: gateForm.qualification || null,
      p_task_title: gate.needsTask ? gateForm.taskTitle : null,
      p_task_due_at: gate.needsTask ? gateForm.taskDueAt : null,
      p_task_type_id: gate.needsTask ? gateForm.taskTypeId : null,
      p_task_assignee_id: gate.needsTask ? gateForm.taskAssigneeId : null,
    });
    if (result.error || !result.data) {
      setFeedback(result.error?.message ?? "Сделка недоступна");
      setPending(false);
      return;
    }
    const transition = result.data as {
      id: string;
      stage_id: string;
      owner_id: string | null;
      status: Deal["status"];
    };
    const confirmed = {
      ...gate.deal,
      stage_id: transition.stage_id,
      owner_id: transition.owner_id,
      status: transition.status,
    };
    setColumns((current) => {
      const removed = current.map((column, index) =>
        index === gate.sourceIndex
          ? { ...column, total: column.total - 1, deals: column.deals.filter((item) => item.id !== gate.deal.id) }
          : column,
      );
      if (gate.lost) return removed;
      return removed.map((column, index) =>
        index === gate.targetIndex
          ? { ...column, total: column.total + 1, deals: [confirmed, ...column.deals] }
          : column,
      );
    });
    setGate(null);
    setPending(false);
    setFeedback("Сделка перемещена");
  }
  async function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    if (pending) return;
    const dealId = String(event.active.id);
    const targetId = event.over?.id ? String(event.over.id) : null;
    const sourceIndex = columns.findIndex((column) =>
      column.deals.some((deal) => deal.id === dealId),
    );
    const targetIndex = columns.findIndex((column) => column.id === targetId);
    const droppingLost = targetId === "lost" && props.lostStageId !== null;
    if (sourceIndex < 0 || (!droppingLost && targetIndex < 0) || (!droppingLost && sourceIndex === targetIndex))
      return;
    const source = columns[sourceIndex];
    const target = droppingLost
      ? {
          id: props.lostStageId as string,
          title: props.lostStageTitle,
          total: props.lostCount,
          deals: [],
          kind: "lost" as const,
        }
      : columns[targetIndex];
    const deal = source.deals.find((item) => item.id === dealId);
    if (!deal) return;
    const needsQualification =
      !droppingLost &&
      target.kind === "open" &&
      target.requires_qualification_tag === true &&
      !(maps.tagsByDeal.get(dealId) ?? []).some(
        (tag) => tag.name === "КВАЛ" || tag.name === "неквал",
      );
    const needsTask =
      !droppingLost && target.kind === "open" && target.requires_next_step === true && !maps.tasks.has(dealId);
    if (droppingLost || needsQualification || needsTask) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(10, 0, 0, 0);
      setGate({
        deal,
        target,
        sourceIndex,
        targetIndex: droppingLost ? -1 : targetIndex,
        lost: droppingLost,
        needsQualification,
        needsTask,
      });
      setGateForm((current) => ({
        ...current,
        qualification: "",
        reasonId: "",
        comment: "",
        taskTitle: "",
        taskDueAt: needsTask
          ? new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
          : "",
        taskTypeId: props.taskTypes[0]?.id ?? "",
        taskAssigneeId: deal.owner_id ?? props.currentUserId,
      }));
      return;
    }
    let targetStage = target;
    let targetIndexForState = targetIndex;
    const update: { stage_id?: string; owner_id?: string | null } = {};
    if (target.kettle) {
      update.owner_id = null;
      if (deal.status === "won") {
        const firstOpen = columns.slice(1).find((column) => column.kind === "open");
        if (!firstOpen) {
          setFeedback("Нет активного open-этапа для возврата сделки");
          return;
        }
        update.stage_id = firstOpen.id;
        targetStage = firstOpen;
        // The card is visually returned to the kettle, while the RPC reopens it
        // on the first active open stage with no owner.
        targetIndexForState = targetIndex;
      }
    } else {
      update.stage_id = target.id;
      if (deal.owner_id === null) update.owner_id = props.currentUserId;
    }
    const nextDeal = { ...deal, ...update };
    const snapshot = columns;
    setColumns(
      columns.map((column, index) =>
        index === sourceIndex
          ? {
              ...column,
              total: column.total - 1,
              deals: column.deals.filter((item) => item.id !== dealId),
            }
          : index === targetIndexForState
            ? {
                ...column,
                total: column.total + 1,
                deals: [nextDeal, ...column.deals],
              }
            : column,
      ),
    );
    setPending(true);
    const result = await createClient().rpc("transition_crm_deal", {
      p_deal_id: dealId,
      p_stage_id: targetStage.kettle ? deal.stage_id : targetStage.id,
      p_owner_id: targetStage.kettle ? null : update.owner_id ?? deal.owner_id,
      p_lost_reason_id: null,
      p_lost_comment: null,
      p_qualification: null,
      p_task_title: null,
      p_task_due_at: null,
      p_task_type_id: null,
      p_task_assignee_id: null,
    });
    if (result.error || !result.data) {
      setColumns(snapshot);
      setFeedback(result.error?.message ?? "Сделка не найдена или недоступна");
      setPending(false);
      return;
    }
    const transition = result.data as { id: string; stage_id: string; owner_id: string | null; status: Deal["status"] };
    const confirmed = { ...deal, ...update, stage_id: transition.stage_id, owner_id: transition.owner_id, status: transition.status };
    setColumns((current) =>
      current.map((column) => ({
        ...column,
        deals: column.deals.map((item) =>
          item.id === dealId ? confirmed : item,
        ),
      })),
    );
    setFeedback("Сделка перемещена");
    setPending(false);
  }
  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragCancel={onDragCancel}
        onDragEnd={onDragEnd}
      >
        <div className="board">
          {columns.map((column) => (
            <BoardColumn key={column.id} column={column} maps={maps} />
          ))}
          <LostDropZone count={props.lostCount} enabled={props.lostStageId !== null} />
        </div>
        <DragOverlay>
          {activeDeal ? (
            <PresentationalCard deal={activeDeal} maps={maps} dragging />
          ) : null}
        </DragOverlay>
      </DndContext>
      {feedback && (
        <div className="dnd-feedback" role="status">
          {feedback}
        </div>
      )}
      {gate && <GateDialog gate={gate} form={gateForm} setForm={setGateForm} props={props} pending={pending} onCancel={() => setGate(null)} onSubmit={commitGate} />}
    </>
  );
}
