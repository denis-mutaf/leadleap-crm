"use client";

import { Check, Clock3, FileText, Phone, Plus } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Person = { id: string; full_name: string; role?: string };
type Task = {
  id: string;
  deal_id: string;
  assignee_id: string;
  title: string;
  due_at: string;
  done_at: string | null;
  done_by: string | null;
  created_at: string;
  is_auto: boolean;
};
type Note = {
  id: string;
  deal_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
};
type Call = {
  id: string;
  direction: "in" | "out";
  status: string | null;
  from_phone: string | null;
  to_phone: string | null;
  user_id: string | null;
  started_at: string;
  answered_at: string | null;
  duration_sec: number | null;
  recording_url: string | null;
};
type Transition = {
  id: string;
  from_stage_id: string | null;
  to_stage_id: string;
  from_status: string | null;
  to_status: string;
  changed_by: string | null;
  changed_at: string;
};
type FeedEntry =
  | { type: "calls"; date: string; item: Call }
  | { type: "notes"; date: string; item: Note }
  | { type: "tasks"; date: string; item: Task }
  | { type: "stages"; date: string; item: Transition };
export type DealRecordData = {
  deal: Record<string, unknown> & {
    id: string;
    contact_id: string;
    owner_id: string | null;
    stage_id: string;
    status: string;
    title: string | null;
    object_text: string | null;
    budget: number | null;
    budget_currency: string;
    amount?: number | null;
    created_at: string;
    updated_at: string;
    source_id: string | null;
    payment: string | null;
    horizon: string | null;
    residency: string | null;
    rooms: number | null;
    purpose: string | null;
    down_payment?: number | null;
    monthly_payment?: number | null;
    down_payment_text?: string | null;
    monthly_payment_text?: string | null;
    purchase_timing_text?: string | null;
    residency_detail?: string | null;
    desired_area_text?: string | null;
    desired_floor_text?: string | null;
    wishes?: string | null;
  };
  contact: {
    id: string;
    full_name: string;
    created_at: string;
    updated_at?: string | null;
  } | null;
  phones: { id: string; phone: string; is_primary: boolean }[];
  channels: {
    id: string;
    channel: string;
    handle: string | null;
    external_id: string;
  }[];
  owner: Person | null;
  stage: { id: string; name: string; kind: string } | null;
  projects: { id: string; code: string; name: string }[];
  tags: { id: string; name: string }[];
  source: { id: string; name: string } | null;
  tasks: Task[];
  notes: Note[];
  calls: Call[];
  transitions: Transition[];
  people: Person[];
  transitionStages: { id: string; name: string }[];
  currentUser: Person;
};

const labels: Record<string, string> = {
  open: "В работе",
  postponed: "Отложена",
  won: "Выиграна",
  lost: "Проиграна",
  cash: "Наличные",
  mortgage: "Ипотека",
  installment: "Рассрочка",
  local: "Местный",
  diaspora: "Диаспора",
  living: "Для жизни",
  investment: "Инвестиция",
};
const fmtDate = (value: string) =>
  new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
const fmtMoney = (value: number | null | undefined, currency = "EUR") =>
  value == null
    ? null
    : `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value)} ${currency}`;

function Field({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="record-field">
      <span>{label}</span>
      <strong>
        {typeof value === "string" && labels[value]
          ? labels[value]
          : String(value)}
      </strong>
    </div>
  );
}
function FeedItem({
  children,
  icon,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
}) {
  return (
    <div className="record-feed-item">
      <span className="record-feed-icon">{icon}</span>
      <div>{children}</div>
    </div>
  );
}

export function DealRecordClient({ data }: { data: DealRecordData }) {
  const router = useRouter();
  const [tab, setTab] = useState("all");
  const [note, setNote] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const people = useMemo(
    () => new Map(data.people.map((person) => [person.id, person])),
    [data.people],
  );
  const stageNames = useMemo(
    () => new Map(data.transitionStages.map((stage) => [stage.id, stage.name])),
    [data.transitionStages],
  );
  const feed: FeedEntry[] = [
    ...data.calls.map((item) => ({
      type: "calls" as const,
      date: item.started_at,
      item,
    })),
    ...data.notes.map((item) => ({
      type: "notes" as const,
      date: item.created_at,
      item,
    })),
    ...data.tasks.map((item) => ({
      type: "tasks" as const,
      date: item.due_at,
      item,
    })),
    ...data.transitions.map((item) => ({
      type: "stages" as const,
      date: item.changed_at,
      item,
    })),
  ]
    .filter((item) => tab === "all" || item.type === tab)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  function showError(error: { message: string } | null) {
    if (error) setFeedback(error.message);
  }
  async function createNote(event: FormEvent) {
    event.preventDefault();
    if (!note.trim() || saving) return;
    setSaving(true);
    const result = await createClient()
      .from("notes")
      .insert({
        deal_id: data.deal.id,
        author_id: data.currentUser.id,
        body: note.trim(),
      });
    setSaving(false);
    if (result.error) showError(result.error);
    else {
      setNote("");
      setFeedback("Примечание добавлено");
      router.refresh();
    }
  }
  async function createTask(event: FormEvent) {
    event.preventDefault();
    if (!taskTitle.trim() || !taskDue || saving) return;
    setSaving(true);
    const result = await createClient()
      .from("tasks")
      .insert({
        deal_id: data.deal.id,
        assignee_id: data.currentUser.id,
        title: taskTitle.trim(),
        due_at: new Date(taskDue).toISOString(),
        created_by: data.currentUser.id,
      });
    setSaving(false);
    if (result.error) showError(result.error);
    else {
      setTaskTitle("");
      setTaskDue("");
      setFeedback("Задача добавлена");
      router.refresh();
    }
  }
  async function completeTask(task: Task) {
    if (saving || task.done_at) return;
    setSaving(true);
    const result = await createClient()
      .from("tasks")
      .update({
        done_at: new Date().toISOString(),
        done_by: data.currentUser.id,
      })
      .eq("id", task.id)
      .select("id")
      .maybeSingle();
    setSaving(false);
    if (result.error || !result.data)
      showError(result.error ?? { message: "Задача недоступна" });
    else {
      setFeedback("Задача выполнена");
      router.refresh();
    }
  }
  return (
    <main className="record-main">
      <div className="record-highlights">
        <div className="record-highlight">
          <span>Этап</span>
          <strong>{data.stage?.name ?? "—"}</strong>
        </div>
        <div className="record-highlight">
          <span>Ответственный</span>
          <strong>{data.owner?.full_name ?? "Общий котёл"}</strong>
        </div>
        <div className="record-highlight">
          <span>Сумма</span>
          <strong>
            {fmtMoney(data.deal.amount, data.deal.budget_currency) ?? "—"}
          </strong>
        </div>
        <div className="record-highlight">
          <span>Обновлено</span>
          <strong>{fmtDate(data.deal.updated_at)}</strong>
        </div>
      </div>
      <div className="record-body">
        <aside className="record-left">
          <section>
            <h2>{data.contact?.full_name ?? "Без имени"}</h2>
            {data.phones.length > 0 && (
              <div className="record-phones">
                {data.phones.map((phone) => (
                  <a href={`tel:${phone.phone}`} key={phone.id}>
                    <Phone size={14} />
                    {phone.phone}
                  </a>
                ))}
              </div>
            )}
          </section>
          <section>
            <h3>Сделка</h3>
            <Field label="Объект" value={data.deal.object_text} />
            <Field label="Источник" value={data.source?.name} />
            <Field
              label="Цена Amo"
              value={fmtMoney(data.deal.amount, data.deal.budget_currency)}
            />
            <Field
              label="Бюджет"
              value={fmtMoney(data.deal.budget, data.deal.budget_currency)}
            />
            <Field
              label="Первоначальный взнос"
              value={
                data.deal.down_payment_text ??
                fmtMoney(data.deal.down_payment, data.deal.budget_currency)
              }
            />
            <Field
              label="Ежемесячный платёж"
              value={
                data.deal.monthly_payment_text ??
                fmtMoney(data.deal.monthly_payment, data.deal.budget_currency)
              }
            />
            <Field
              label="Срок покупки"
              value={data.deal.purchase_timing_text ?? data.deal.horizon}
            />
            <Field
              label="Резиденция"
              value={data.deal.residency_detail ?? data.deal.residency}
            />
            <Field label="Площадь" value={data.deal.desired_area_text} />
            <Field label="Этаж" value={data.deal.desired_floor_text} />
            <Field label="Пожелания" value={data.deal.wishes} />
          </section>
          {data.projects.length > 0 && (
            <section>
              <h3>Проекты</h3>
              <div className="record-chips">
                {data.projects.map((project) => (
                  <span key={project.id}>{project.name}</span>
                ))}
              </div>
            </section>
          )}
          {data.tags.length > 0 && (
            <section>
              <h3>Метки</h3>
              <div className="record-chips">
                {data.tags.map((tag) => (
                  <span key={tag.id}>{tag.name}</span>
                ))}
              </div>
            </section>
          )}
        </aside>
        <section className="record-right">
          <div className="record-tabs">
            {[
              ["all", "Все"],
              ["calls", "Звонки"],
              ["notes", "Примечания"],
              ["tasks", "Задачи"],
              ["stages", "Этапы"],
            ].map(([value, label]) => (
              <button
                className={tab === value ? "is-active" : ""}
                onClick={() => setTab(value)}
                key={value}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="record-actions">
            <form onSubmit={createNote}>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Добавить примечание…"
                aria-label="Примечание"
              />
              <button disabled={saving || !note.trim()}>
                <Plus size={14} /> Примечание
              </button>
            </form>
            <form onSubmit={createTask}>
              <input
                value={taskTitle}
                onChange={(event) => setTaskTitle(event.target.value)}
                placeholder="Новая задача"
                aria-label="Название задачи"
              />
              <input
                type="datetime-local"
                value={taskDue}
                onChange={(event) => setTaskDue(event.target.value)}
                aria-label="Дата и время задачи"
              />
              <button disabled={saving || !taskTitle.trim() || !taskDue}>
                <Plus size={14} /> Задача
              </button>
            </form>
          </div>
          <div className="record-feed">
            {feed.length === 0 && (
              <p className="record-empty">Записей пока нет.</p>
            )}
            {feed.map((entry) => (
              <div key={`${entry.type}-${entry.item.id}`}>
                <time>{fmtDate(entry.date)}</time>
                {entry.type === "calls" && (
                  <FeedItem icon={<Phone size={15} />}>
                    <strong>
                      {entry.item.direction === "in"
                        ? "Входящий звонок"
                        : "Исходящий звонок"}
                    </strong>
                    <span className="record-muted">
                      {" "}
                      {entry.item.status ?? ""}
                    </span>
                    {entry.item.recording_url && (
                      <audio
                        controls
                        src={entry.item.recording_url}
                        className="record-audio"
                      />
                    )}
                  </FeedItem>
                )}
                {entry.type === "notes" && (
                  <FeedItem icon={<FileText size={15} />}>
                    <p>{entry.item.body}</p>
                    <small>
                      {people.get(entry.item.author_id ?? "")?.full_name ??
                        "Сотрудник"}
                    </small>
                  </FeedItem>
                )}
                {entry.type === "tasks" && (
                  <FeedItem icon={<Check size={15} />}>
                    <button
                      className={`record-task ${entry.item.done_at ? "done" : ""}`}
                      onClick={() => completeTask(entry.item)}
                      disabled={Boolean(entry.item.done_at) || saving}
                    >
                      <span className="record-check">
                        {entry.item.done_at ? <Check size={12} /> : null}
                      </span>
                      <span>{entry.item.title}</span>
                      <small>
                        {entry.item.done_at
                          ? "Выполнена"
                          : fmtDate(entry.item.due_at)}
                      </small>
                    </button>
                  </FeedItem>
                )}
                {entry.type === "stages" && (
                  <FeedItem icon={<Clock3 size={15} />}>
                    <strong>
                      {stageNames.get(entry.item.to_stage_id) ?? "Этап"}
                    </strong>
                    <span className="record-muted">
                      {" "}
                      · {labels[entry.item.to_status] ?? entry.item.to_status}
                    </span>
                    <small>
                      {people.get(entry.item.changed_by ?? "")?.full_name ??
                        "Система"}
                    </small>
                  </FeedItem>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
      {feedback && (
        <div className="record-feedback" role="status">
          {feedback}
        </div>
      )}
    </main>
  );
}
