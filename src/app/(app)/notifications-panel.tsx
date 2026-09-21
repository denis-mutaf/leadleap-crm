"use client";

import {
  Bell,
  Calendar,
  CircleAlert,
  Inbox,
  MessageCircle,
  Phone,
  PhoneMissed,
  UserPlus,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import styles from "./notifications-panel.module.css";

type Notification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  deal_id: string | null;
  contact_id: string | null;
  created_at: string;
  read_at: string | null;
};
type Filter = "all" | "unread";
const PAGE_SIZE = 20;
const zone = "Europe/Chisinau";
const icons = {
  incoming_call: Phone,
  new_lead: Inbox,
  new_message: MessageCircle,
  task_overdue: CircleAlert,
  postponed_due: Calendar,
  phone_missed: PhoneMissed,
  deal_stage_changed: ArrowRight,
  deal_assigned: UserPlus,
} as const;
const dateKey = (value: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
const dayName = (value: string) => {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const key = dateKey(value);
  if (key === dateKey(now.toISOString())) return "Сегодня";
  if (key === dateKey(yesterday.toISOString())) return "Вчера";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: zone,
    day: "numeric",
    month: "long",
  }).format(new Date(value));
};
const timeName = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export function NotificationsPanel({ role }: { role: string }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [items, setItems] = useState<Notification[]>([]);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const requestRef = useRef(0);
  const supabase = useMemo(() => createClient(), []);
  const load = useCallback(
    async (reset: boolean) => {
      const request = ++requestRef.current;
      const offset = reset ? 0 : items.length;
      setLoading(true);
      setError(null);
      const countQuery =
        filter === "unread"
          ? supabase
              .from("notifications")
              .select("id", { count: "exact", head: true })
              .is("read_at", null)
          : supabase
              .from("notifications")
              .select("id", { count: "exact", head: true });
      const unreadQuery = supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null);
      const [countResult, unreadResult] = await Promise.all([
        countQuery,
        unreadQuery,
      ]);
      if (request !== requestRef.current) return;
      if (countResult.error || unreadResult.error) {
        setError("Не удалось загрузить уведомления");
        setLoading(false);
        return;
      }
      const nextTotal = countResult.count ?? 0;
      setTotal(nextTotal);
      setUnread(unreadResult.count ?? 0);
      if (offset >= nextTotal) {
        if (reset) setItems([]);
        setLoading(false);
        return;
      }
      let query = supabase
        .from("notifications")
        .select("id,kind,title,body,deal_id,contact_id,created_at,read_at")
        .order("created_at", { ascending: false })
        .range(offset, Math.min(offset + PAGE_SIZE - 1, nextTotal - 1));
      if (filter === "unread") query = query.is("read_at", null);
      const result = await query;
      if (request !== requestRef.current) return;
      if (result.error) setError("Не удалось загрузить уведомления");
      else
        setItems((current) =>
          reset
            ? (result.data as Notification[])
            : [...current, ...(result.data as Notification[])],
        );
      setLoading(false);
    },
    [filter, items.length, supabase],
  );
  useEffect(() => {
    const timer = window.setTimeout(() => void load(true), 0);
    return () => window.clearTimeout(timer);
  }, [filter, load]);
  useEffect(() => {
    if (!open) return;
    const close = () => {
      requestRef.current += 1;
      setOpen(false);
      triggerRef.current?.focus();
    };
    const outside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  if (role === "builder") return null;
  const markRead = async (id: string) => {
    setPending(id);
    const readAt = new Date().toISOString();
    const result = await supabase
      .from("notifications")
      .update({ read_at: readAt })
      .eq("id", id)
      .select("id,read_at")
      .single();
    if (result.error) setError("Не удалось отметить уведомление");
    else {
      setItems((current) =>
        current.map((item) =>
          item.id === id ? { ...item, read_at: result.data.read_at } : item,
        ),
      );
      setUnread((current) => Math.max(0, current - 1));
    }
    setPending(null);
  };
  const markAll = async () => {
    setPending("all");
    const readAt = new Date().toISOString();
    const result = await supabase
      .from("notifications")
      .update({ read_at: readAt })
      .is("read_at", null)
      .select("id");
    if (result.error) setError("Не удалось отметить уведомления");
    else {
      setItems((current) =>
        current.map((item) => ({ ...item, read_at: item.read_at ?? readAt })),
      );
      setUnread(0);
    }
    setPending(null);
  };
  const grouped = items.reduce<Record<string, Notification[]>>(
    (groups, item) => {
      (groups[dayName(item.created_at)] ??= []).push(item);
      return groups;
    },
    {},
  );
  const row = (item: Notification, action: React.ReactNode) => {
    const Icon = icons[item.kind as keyof typeof icons] ?? Bell;
    return (
      <div className={`${styles.row} ${!item.read_at ? styles.unread : ""}`}>
        <span className={styles.icon}>
          <Icon size={15} />
        </span>
        <span className={styles.copy}>
          <span className={styles.title}>{item.title}</span>
          <span className={styles.bodyText}>{item.body ?? ""}</span>
        </span>
        <time className={styles.time} dateTime={item.created_at}>
          {timeName(item.created_at)}
        </time>
        <span
          className={styles.dot}
          style={{ opacity: item.read_at ? 0 : 1 }}
        />
        {action}
      </div>
    );
  };
  return (
    <div className={styles.root} ref={rootRef}>
      <button
        ref={triggerRef}
        className={styles.bell}
        aria-label={`Уведомления${unread ? `, ${unread} непрочитанных` : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={17} />
        {unread > 0 && (
          <span className={styles.count}>{unread > 99 ? "99+" : unread}</span>
        )}
      </button>
      {open && (
        <section className={styles.panel} aria-label="Уведомления">
          <div className={styles.header}>
            <h2>Уведомления</h2>
            <button
              className={styles.quiet}
              disabled={!unread || pending !== null}
              onClick={() => void markAll()}
            >
              Прочитать все
            </button>
          </div>
          <div className={styles.tabs} role="tablist">
            <button
              role="tab"
              aria-current={filter === "all" ? "page" : undefined}
              className={`${styles.tab} ${filter === "all" ? styles.tabActive : ""}`}
              onClick={() => {
                requestRef.current += 1;
                setItems([]);
                setFilter("all");
              }}
            >
              Все
            </button>
            <button
              role="tab"
              aria-current={filter === "unread" ? "page" : undefined}
              className={`${styles.tab} ${filter === "unread" ? styles.tabActive : ""}`}
              onClick={() => {
                requestRef.current += 1;
                setItems([]);
                setFilter("unread");
              }}
            >
              Непрочитанные{unread ? ` ${unread}` : ""}
            </button>
          </div>
          <div className={styles.body}>
            {loading && !items.length ? (
              <div className={styles.status}>Загрузка…</div>
            ) : error ? (
              <div className={`${styles.status} ${styles.error}`}>{error}</div>
            ) : !items.length ? (
              <div className={styles.status}>
                {filter === "unread"
                  ? "Нет непрочитанных уведомлений"
                  : "Уведомлений пока нет"}
              </div>
            ) : (
              Object.entries(grouped).map(([day, dayItems]) => (
                <div key={day}>
                  <div className={styles.groupTitle}>{day}</div>
                  {dayItems.map((item) => {
                    const action =
                      !item.read_at && !(item.deal_id || item.contact_id) ? (
                        <button
                          className={styles.readButton}
                          disabled={pending === item.id}
                          onClick={() => void markRead(item.id)}
                        >
                          {pending === item.id ? "…" : "Прочитать"}
                        </button>
                      ) : null;
                    if (item.deal_id || item.contact_id)
                      return (
                        <Link
                          href={
                            item.deal_id
                              ? `/deals/${item.deal_id}`
                              : `/contacts/${item.contact_id}`
                          }
                          key={item.id}
                          className={styles.linkRow}
                          onClick={() => {
                            if (!item.read_at) void markRead(item.id);
                          }}
                        >
                          {row(item, action)}
                        </Link>
                      );
                    return <div key={item.id}>{row(item, action)}</div>;
                  })}
                </div>
              ))
            )}
          </div>
          {items.length < total && !error && (
            <div className={styles.footer}>
              <button
                className={styles.quiet}
                disabled={loading || pending !== null}
                onClick={() => void load(false)}
              >
                {loading ? "Загрузка…" : "Показать ещё"}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
