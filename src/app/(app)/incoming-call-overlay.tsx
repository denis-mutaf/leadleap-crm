"use client";

import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  Clock3,
  PhoneIncoming,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import styles from "./incoming-call-overlay.module.css";

type Notice = {
  id: string;
  kind: "incoming_call" | "new_lead";
  title: string;
  contact_id: string | null;
  deal_id: string | null;
  created_at: string;
  payload: { phone?: string; callid?: string; deals?: string[] };
};
type Deal = {
  id: string;
  title: string | null;
  object_text: string | null;
  updated_at: string;
  stage_id: string;
  contact_id: string;
};
type Touch = { icon: string; text: string; at: string; timestamp: number };
type Detail = {
  name?: string;
  stage?: string;
  project?: string;
  tag?: string;
  overdue?: string;
  touches: Touch[];
};
const emptyDetail: Detail = { touches: [] };
const elapsed = (date: string) => {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(date).getTime()) / 1000),
  );
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};
const formatTouchTime = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Chisinau",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export function IncomingCallOverlay({
  role,
  actorId,
}: {
  role: string;
  actorId: string;
}) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [detail, setDetail] = useState<Detail>(emptyDetail);
  const [note, setNote] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [tick, setTick] = useState(0);
  const [pending, setPending] = useState<"close" | "note" | "create" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef<"close" | "note" | "create" | null>(null);
  const pollInFlight = useRef(false);
  const request = useRef(0);
  const supabase = useMemo(() => createClient(), []);
  const active = ["manager", "head", "admin"].includes(role);

  const poll = useCallback(async () => {
    if (
      !active ||
      document.visibilityState !== "visible" ||
      pollInFlight.current
    )
      return;
    pollInFlight.current = true;
    try {
      const result = await supabase
        .from("notifications")
        .select("id,kind,title,contact_id,deal_id,created_at,payload")
        .is("read_at", null)
        .in("kind", ["incoming_call", "new_lead"])
        .order("created_at", { ascending: false })
        .limit(5);
      if (result.error) {
        setError("Не удалось проверить входящий звонок");
        return;
      }
      const next = (result.data ?? []).find(
        (item) => (item.payload as Notice["payload"] | null)?.callid,
      ) as Notice | undefined;
      if (!next) {
        request.current += 1;
        setNotice(null);
        return;
      }
      setError(null);
      setNotice((current) => (current?.id === next.id ? current : next));
    } finally {
      pollInFlight.current = false;
    }
  }, [active, supabase]);

  useEffect(() => {
    if (!active) return;
    void poll();
    const channel = supabase
      .channel(`incoming-call-${actorId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${actorId}`,
        },
        () => void poll(),
      )
      .subscribe();
    const timer = window.setInterval(() => void poll(), 15000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      void supabase.removeChannel(channel);
      request.current += 1;
    };
  }, [active, actorId, poll, supabase]);

  useEffect(() => {
    if (!notice) {
      const timer = window.setTimeout(() => {
        setDeal(null);
        setDeals([]);
        setDetail(emptyDetail);
        setNote("");
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const requestId = ++request.current;
    const load = async () => {
      const dealIds =
        notice.payload.deals?.slice(0, 5) ??
        (notice.deal_id ? [notice.deal_id] : []);
      const contactQuery = notice.contact_id
        ? supabase
            .from("contacts")
            .select("full_name")
            .eq("id", notice.contact_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null });
      const dealsQuery = dealIds.length
        ? supabase
            .from("deals")
            .select("id,title,object_text,updated_at,stage_id,contact_id")
            .in("id", dealIds)
            .order("updated_at", { ascending: false })
            .limit(5)
        : Promise.resolve({ data: [], error: null });
      const [contactResult, dealsResult] = await Promise.all([
        contactQuery,
        dealsQuery,
      ]);
      if (requestId !== request.current) return;
      if (contactResult.error) {
        setError("Не удалось загрузить контакт");
        return;
      }
      if (dealsResult.error) {
        setError("Не удалось загрузить данные сделки");
        return;
      }
      const rows = (dealsResult.data ?? []) as Deal[];
      setDeals(rows);
      setDeal(rows[0] ?? null);
      setDetail({
        name: contactResult.data?.full_name as string | undefined,
        touches: [],
      });
    };
    void load();
  }, [notice, supabase]);

  useEffect(() => {
    if (!deal) return;
    const requestId = ++request.current;
    const reload = async () => {
      const [stage, overdue, projects, tags, calls, notes, conversations] =
        await Promise.all([
          supabase
            .from("stages")
            .select("name")
            .eq("id", deal.stage_id)
            .maybeSingle(),
          supabase
            .from("tasks")
            .select("title")
            .eq("deal_id", deal.id)
            .is("done_at", null)
            .lt("due_at", new Date().toISOString())
            .order("due_at", { ascending: true })
            .limit(1)
            .maybeSingle(),
          supabase
            .from("deal_projects")
            .select("projects(name)")
            .eq("deal_id", deal.id)
            .limit(2),
          supabase
            .from("deal_tags")
            .select("tags(name)")
            .eq("deal_id", deal.id)
            .limit(3),
          supabase
            .from("calls")
            .select("direction,started_at")
            .eq("deal_id", deal.id)
            .order("started_at", { ascending: false })
            .limit(3),
          supabase
            .from("notes")
            .select("body,created_at")
            .eq("deal_id", deal.id)
            .order("created_at", { ascending: false })
            .limit(3),
          supabase
            .from("conversations")
            .select("id")
            .eq("contact_id", deal.contact_id)
            .order("last_message_at", { ascending: false })
            .limit(3),
        ]);
      if (requestId !== request.current) return;
      const enrichmentErrors = [
        stage,
        overdue,
        projects,
        tags,
        calls,
        notes,
        conversations,
      ].filter((result) => result.error);
      if (enrichmentErrors.length) {
        setError("Не удалось загрузить детали сделки");
        return;
      }
      const conversationIds = (conversations.data ?? [])
        .map((item) => item.id as string)
        .slice(0, 3);
      const messages = conversationIds.length
        ? await supabase
            .from("messages")
            .select("body,sent_at")
            .in("conversation_id", conversationIds)
            .order("sent_at", { ascending: false })
            .limit(3)
        : { data: [], error: null };
      if (requestId !== request.current) return;
      if (messages.error) {
        setError("Не удалось загрузить историю сообщений");
        return;
      }
      const touches: Touch[] = [
        ...(calls.data ?? []).map((item) => ({
          icon: "↗",
          text:
            item.direction === "in" ? "Входящий звонок" : "Исходящий звонок",
          at: formatTouchTime(item.started_at as string),
          timestamp: new Date(item.started_at as string).getTime(),
        })),
        ...(notes.data ?? []).map((item) => ({
          icon: "✎",
          text: item.body as string,
          at: formatTouchTime(item.created_at as string),
          timestamp: new Date(item.created_at as string).getTime(),
        })),
        ...(messages.data ?? []).map((item) => ({
          icon: "◌",
          text: item.body || "Сообщение",
          at: formatTouchTime(item.sent_at as string),
          timestamp: new Date(item.sent_at as string).getTime(),
        })),
      ]
        .sort((left, right) => right.timestamp - left.timestamp)
        .slice(0, 3);
      setDetail((current) => ({
        ...current,
        stage: stage.data?.name as string | undefined,
        project: (
          projects.data?.[0] as { projects?: { name?: string } } | undefined
        )?.projects?.name,
        tag: (tags.data?.[0] as { tags?: { name?: string } } | undefined)?.tags
          ?.name,
        overdue: overdue.data
          ? `Просрочено · ${overdue.data.title}`
          : undefined,
        touches,
      }));
    };
    void reload();
  }, [deal, supabase]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [notice]);

  const close = async () => {
    if (!notice || pendingRef.current) return;
    pendingRef.current = "close";
    setPending("close");
    try {
      const result = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", notice.id)
        .select("id")
        .maybeSingle();
      if (result.error || !result.data) setError("Не удалось закрыть звонок");
      else {
        request.current += 1;
        setNotice(null);
      }
    } catch {
      setError("Не удалось закрыть звонок");
    } finally {
      pendingRef.current = null;
      setPending(null);
    }
  };
  const saveNote = async () => {
    if (!deal || !note.trim() || pendingRef.current) return;
    pendingRef.current = "note";
    setPending("note");
    setError(null);
    try {
      const result = await supabase
        .from("notes")
        .insert({
          deal_id: deal.id,
          contact_id: deal.contact_id,
          author_id: actorId,
          body: note.trim(),
        })
        .select("id")
        .single();
      if (result.error || !result.data)
        setError("Не удалось сохранить заметку");
      else {
        const createdAt = new Date().toISOString();
        setNote("");
        setDetail((current) => ({
          ...current,
          touches: [
            {
              icon: "✓",
              text: "Заметка сохранена",
              at: formatTouchTime(createdAt),
              timestamp: new Date(createdAt).getTime(),
            },
            ...current.touches,
          ]
            .sort((left, right) => right.timestamp - left.timestamp)
            .slice(0, 3),
        }));
      }
    } catch {
      setError("Не удалось сохранить заметку");
    } finally {
      pendingRef.current = null;
      setPending(null);
    }
  };
  const createDeal = async () => {
    if (!notice || !unknown || pendingRef.current) return;
    const phone = notice.payload.phone ?? "Номер не указан";
    if (phone === "Номер не указан") {
      setError("У входящего звонка нет номера");
      return;
    }
    pendingRef.current = "create";
    setPending("create");
    setError(null);
    try {
      const contactResult = await supabase
        .from("contacts")
        .insert({ full_name: phone, created_by: actorId })
        .select("id, full_name")
        .single();
      if (contactResult.error) throw new Error("Не удалось создать контакт");
      const phoneResult = await supabase
        .from("contact_phones")
        .insert({ contact_id: contactResult.data.id, phone, is_primary: true });
      if (phoneResult.error) throw new Error("Не удалось сохранить номер");
      const stageResult = await supabase
        .from("stages")
        .select("id")
        .eq("is_active", true)
        .order("position")
        .limit(1)
        .maybeSingle();
      if (stageResult.error || !stageResult.data) throw new Error("Не найден этап для новой сделки");
      const dealResult = await supabase
        .from("deals")
        .insert({
          contact_id: contactResult.data.id,
          owner_id: actorId,
          stage_id: stageResult.data.id,
          title: `Входящий звонок ${phone}`,
          created_by: actorId,
        })
        .select("id, title, object_text, updated_at, stage_id, contact_id")
        .single();
      if (dealResult.error) throw new Error("Не удалось создать сделку");
      await supabase
        .from("notifications")
        .update({ contact_id: contactResult.data.id, deal_id: dealResult.data.id })
        .eq("id", notice.id);
      setNotice((current) => current ? { ...current, kind: "incoming_call", contact_id: contactResult.data.id, deal_id: dealResult.data.id } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось создать сделку");
    } finally {
      pendingRef.current = null;
      setPending(null);
    }
  };
  if (!active || !notice) return null;
  const phone = notice.payload.phone ?? "Номер не указан";
  const unknown = notice.kind === "new_lead";
  const currentIndex = deals.findIndex((item) => item.id === deal?.id);
  void tick;

  return (
    <aside
      className={`${styles.card} motion-panel ${collapsed ? styles.collapsed : ""}`}
      aria-live="polite"
    >
      <header className={styles.header}>
        <span>
          <PhoneIncoming size={16} /> Входящий звонок
        </span>
        <time>
          <Clock3 size={13} /> {elapsed(notice.created_at)}
        </time>
        <button
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? "Развернуть" : "Свернуть"}
        >
          <ChevronDown size={16} />
        </button>
        {/* Карточку звонка можно было только свернуть: убрать её с экрана было
            нечем, хотя close() — пометить уведомление прочитанным — написан. */}
        <button
          onClick={() => void close()}
          disabled={pending !== null}
          aria-label="Убрать карточку звонка"
        >
          <X size={16} />
        </button>
      </header>
      {!collapsed && (
        <>
          <div className={styles.person}>
            <strong>{unknown ? phone : (detail.name ?? phone)}</strong>
            <small>{unknown ? "Номера нет в базе" : phone}</small>
          </div>
          {!unknown && deal && (
            <div className={styles.deal}>
              <div className={styles.chips}>
                {detail.stage && <span>{detail.stage}</span>}
                {detail.project && <span>{detail.project}</span>}
                {detail.tag && <span>{detail.tag}</span>}
              </div>
              <p>{deal.object_text ?? deal.title ?? "Без названия"}</p>
            </div>
          )}
          {unknown ? (
            <p className={styles.quiet}>Звонит впервые</p>
          ) : (
            <div className={styles.touches}>
              {detail.touches.length ? (
                detail.touches.map((touch, index) => (
                  <p key={`${touch.at}-${index}`}>
                    <span>
                      {touch.icon} {touch.text}
                    </span>
                    <time>{touch.at}</time>
                  </p>
                ))
              ) : (
                <p>История касаний пока пуста</p>
              )}
            </div>
          )}
          {detail.overdue && (
            <div className={styles.overdue}>{detail.overdue}</div>
          )}
          {(
            <div className={styles.noteBox}>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Записать по ходу разговора…"
                rows={3}
              />
              <button
                onClick={() => void saveNote()}
                disabled={!deal || !note.trim() || pending !== null}
              >
                <Check size={14} />{" "}
                {pending === "note" ? "Сохраняем…" : "Сохранить заметку"}
              </button>
            </div>
          )}
          {error && <p className={styles.error}>{error}</p>}
          <footer>
            {unknown ? (
              <Link href={`/contacts?q=${encodeURIComponent(phone)}`}>
                Найти контакт
              </Link>
            ) : deals.length > 1 ? (
              <button
                onClick={() =>
                  setDeal(deals[(currentIndex + 1) % deals.length])
                }
              >
                <ArrowLeftRight size={14} /> Другая сделка
              </button>
            ) : null}
            {deal ? (
              <Link href={`/deals/${deal.id}`}>Открыть сделку</Link>
            ) : null}
            {unknown && !deal && (
              <button className={styles.primaryAction} onClick={() => void createDeal()} disabled={pending !== null}>
                {pending === "create" ? "Создаём…" : "Создать сделку"}
              </button>
            )}
          </footer>
        </>
      )}
    </aside>
  );
}
