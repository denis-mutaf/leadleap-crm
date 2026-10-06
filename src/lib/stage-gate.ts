// Гейты перехода по воронке: что нужно сделке, чтобы попасть на этап.
// Сервер (триггеры и transition_crm_deal) — последняя инстанция; здесь те же
// правила считаются заранее, чтобы модалка просила нужное, а не получала отказ.
import type { createClient } from "@/lib/supabase/client";
import { dbErrorText } from "@/lib/db-errors";

type Db = ReturnType<typeof createClient>;

export type GateStage = {
  id: string;
  name: string;
  kind: "open" | "won" | "lost";
  position: number;
  requires_next_step?: boolean;
  requires_qualification_tag?: boolean;
  requires_qualification?: boolean;
};

export type Qualification = "КВАЛ" | "неквал";

export type GateForm = {
  qualification: Qualification | "";
  reasonId: string;
  comment: string;
  closeTasks: boolean;
  taskTitle: string;
  taskDueAt: string;
  taskTypeId: string;
  taskAssigneeId: string;
};

// Срез сделки, нужный для решения «что спросить у менеджера».
export type GateSnapshot = {
  tags: string[];
  hasFutureTask: boolean;
  openTasks: number;
  missingFields: string[];
};

export type GatePlan = {
  lost: boolean;
  needsQualification: boolean;
  needsTask: boolean;
  missingFields: string[];
  openTasks: number;
  /** Текст запрета: переход невозможен, пока не изменится сделка. */
  blocked: string | null;
};

// Этап, дальше которого «неквал» не идёт (решение владельца, 06.10).
const UNQUALIFIED_LIMIT_STAGE = "в работе";
// Парковка для тех, кто пропал или не готов: неквалу туда можно (как и в БД, amo:stage:40).
const UNQUALIFIED_PARKING_PREFIX = "перестал отвечать";
export const UNQUALIFIED_BLOCK_TEXT = "Неквалифицированную сделку нельзя перевести дальше этапа «В работе»";

export const emptyGateForm = (taskTypeId: string, taskAssigneeId: string): GateForm => ({
  qualification: "", reasonId: "", comment: "", closeTasks: true, taskTitle: "", taskDueAt: "", taskTypeId, taskAssigneeId,
});

const isQualificationTag = (name: string): name is Qualification => name === "КВАЛ" || name === "неквал";

const filled = (value: unknown) => value !== null && value !== undefined && String(value).trim() !== "";

// Поля квалификации. «Срок покупки» и «В стране» в карточке редактируются
// текстом (purchase_timing_text / residency_detail), перечисления horizon и
// residency остались от старой модели — заполненным считается любое из двух.
export function missingQualificationFields(deal: Record<string, unknown>): string[] {
  const rules: [string, boolean][] = [
    ["бюджет", filled(deal.budget)],
    ["способ оплаты", filled(deal.payment)],
    ["срок покупки", filled(deal.horizon) || filled(deal.purchase_timing_text)],
    ["диаспора или местный", filled(deal.residency) || filled(deal.residency_detail)],
    ["комнатность", filled(deal.rooms)],
    ["цель покупки", filled(deal.purpose)],
  ];
  return rules.filter(([, ok]) => !ok).map(([label]) => label);
}

/** Свежий срез сделки из базы: метки, будущие задачи, пустые поля. */
export async function loadGateSnapshot(db: Db, dealId: string, withFields: boolean): Promise<GateSnapshot> {
  const [tags, future, open, fields] = await Promise.all([
    db.from("deal_tags").select("tags(name)").eq("deal_id", dealId),
    db.from("tasks").select("id", { count: "exact", head: true }).eq("deal_id", dealId).is("done_at", null).is("deleted_at", null).gt("due_at", new Date().toISOString()),
    db.from("tasks").select("id", { count: "exact", head: true }).eq("deal_id", dealId).is("done_at", null).is("deleted_at", null),
    withFields
      ? db.from("deals").select("budget, payment, horizon, purchase_timing_text, residency, residency_detail, rooms, purpose").eq("id", dealId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const error = tags.error ?? future.error ?? open.error ?? fields.error;
  if (error) throw error;
  const names = ((tags.data ?? []) as unknown as { tags: { name: string } | { name: string }[] | null }[])
    .flatMap((row) => (Array.isArray(row.tags) ? row.tags : row.tags ? [row.tags] : []))
    .map((tag) => tag.name);
  return {
    tags: names,
    hasFutureTask: (future.count ?? 0) > 0,
    openTasks: open.count ?? 0,
    missingFields: fields.data ? missingQualificationFields(fields.data as Record<string, unknown>) : [],
  };
}

export function unqualifiedBlocks(target: GateStage, stages: readonly GateStage[]): boolean {
  if (target.kind === "lost") return false;
  if (target.name.trim().toLowerCase().startsWith(UNQUALIFIED_PARKING_PREFIX)) return false;
  const limit = stages.find((stage) => stage.name.trim().toLowerCase() === UNQUALIFIED_LIMIT_STAGE);
  return Boolean(limit) && target.position > (limit as GateStage).position;
}

/** Нужно ли заранее читать срез сделки: у целевого этапа есть гейты. */
export function targetHasGates(target: GateStage): boolean {
  return target.kind === "lost" || (target.kind === "open" && Boolean(target.requires_next_step || target.requires_qualification_tag || target.requires_qualification));
}

export function planGate(input: { target: GateStage; source: GateStage | undefined; stages: readonly GateStage[]; snapshot: GateSnapshot; qualification: Qualification | "" }): GatePlan {
  const { target, source, stages, snapshot } = input;
  const lost = target.kind === "lost";
  const forward = !lost && target.kind === "open" && target.position > (source?.position ?? 0);
  const marked = snapshot.tags.find(isQualificationTag);
  const qualification = input.qualification || marked || "";
  const needsQualification = forward && target.requires_qualification_tag === true && !marked;
  const needsTask = forward && target.requires_next_step === true && !snapshot.hasFutureTask;
  const missingFields = forward && target.requires_qualification === true ? snapshot.missingFields : [];
  const blocked = !lost && qualification === "неквал" && unqualifiedBlocks(target, stages) ? UNQUALIFIED_BLOCK_TEXT : null;
  return { lost, needsQualification, needsTask, missingFields, openTasks: lost ? snapshot.openTasks : 0, blocked };
}

/** Дата в формате пикера («YYYY-MM-DDTHH:mm») на завтра, 10:00. */
export function tomorrowMorning(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(10, 0, 0, 0);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** Текст для менеджера: известная ошибка — по-русски, неизвестная — с исходным сообщением базы. */
export function transitionErrorText(error: unknown): string {
  const fallback = "Не удалось сменить этап";
  const text = dbErrorText(error, fallback);
  if (text !== fallback) return text;
  const message = typeof error === "object" && error && typeof (error as { message?: unknown }).message === "string" ? (error as { message: string }).message.trim() : "";
  return message ? `${fallback}: ${message}` : fallback;
}

export type TransitionArgs = {
  dealId: string;
  stageId: string;
  ownerId: string | null;
  lostReasonId?: string | null;
  lostComment?: string | null;
  qualification?: Qualification | "" | null;
  task?: { title: string; dueAt: string; typeId: string; assigneeId: string } | null;
};

export type TransitionResult =
  | { ok: true; data: { stage_id: string; owner_id: string | null; status: string } }
  | { ok: false; message: string };

export async function transitionDeal(db: Db, args: TransitionArgs): Promise<TransitionResult> {
  const result = await db.rpc("transition_crm_deal", {
    p_deal_id: args.dealId,
    p_stage_id: args.stageId,
    p_owner_id: args.ownerId,
    p_lost_reason_id: args.lostReasonId ?? null,
    p_lost_comment: args.lostComment?.trim() || null,
    p_qualification: args.qualification || null,
    p_task_title: args.task?.title ?? null,
    p_task_due_at: args.task?.dueAt ?? null,
    p_task_type_id: args.task?.typeId ?? null,
    p_task_assignee_id: args.task?.assigneeId ?? null,
  });
  if (result.error || !result.data) return { ok: false, message: result.error ? transitionErrorText(result.error) : "Сделка недоступна" };
  return { ok: true, data: result.data as { stage_id: string; owner_id: string | null; status: string } };
}

/** После отказа открытые задачи сделки закрываются с пометкой. Возвращает число закрытых. */
export async function closeOpenTasks(db: Db, dealId: string, userId: string): Promise<{ closed: number; failed: boolean }> {
  const result = await db.from("tasks").update({ done_at: new Date().toISOString(), done_by: userId, result_text: "Сделка закрыта как отказ" }).eq("deal_id", dealId).is("done_at", null).is("deleted_at", null).select("id");
  return { closed: result.data?.length ?? 0, failed: Boolean(result.error) };
}
