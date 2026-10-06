"use client";

import { AlarmClock, CalendarClock } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import styles from "./sla-chip.module.css";

// Один таймер на всю доску: по таймеру на карточку при сотнях карточек — лишняя нагрузка.
const TICK_MS = 30_000;
let tickNow = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    tickNow = Date.now();
    timer = setInterval(() => { tickNow = Date.now(); listeners.forEach((item) => item()); }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) { clearInterval(timer); timer = undefined; }
  };
}
const snapshot = () => tickNow;
const serverSnapshot = () => 0;

function duration(minutes: number) {
  const value = Math.max(0, minutes);
  if (value < 1) return "меньше минуты";
  if (value < 60) return `${value} мин`;
  const hours = Math.floor(value / 60);
  if (hours >= 48) return `${Math.floor(hours / 24)} дн`;
  const rest = value % 60;
  return rest && hours < 10 ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

// Сервер отдаёт остаток в рабочих минутах на момент загрузки. Пока идёт один
// непрерывный рабочий отрезок, он совпадает с календарным, и счётчик можно
// вести по часам. Ночью и в выходные остаток не меняется — тогда показываем
// значение сервера как есть.
function leftMinutes(dueAt: string, serverLeft: number, loadedAt: number, now: number) {
  if (!now) return serverLeft;
  const due = new Date(dueAt).getTime();
  const wallAtLoad = (due - loadedAt) / 60_000;
  if (Math.abs(wallAtLoad - serverLeft) > 1.5) return serverLeft;
  return Math.floor((due - now) / 60_000);
}

export function SlaChip({ dueAt, leftMin }: { dueAt: string; leftMin: number }) {
  const [loadedAt] = useState(() => Date.now());
  const now = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const left = leftMinutes(dueAt, leftMin, loadedAt, now);
  // Срок вышел, а рабочих минут с него не прошло (ночь, выходной): всё равно просрочено.
  const overdue = left < 0 || (left === 0 && new Date(dueAt).getTime() <= (now || loadedAt));
  const soon = !overdue && left <= 10;
  const text = overdue ? `Просрочено ${duration(-left)}` : left < 1 ? "Ответить сейчас" : `Ответить за ${duration(left)}`;
  const due = new Date(dueAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Chisinau" });
  return (
    <span className={`${styles.chip} ${overdue ? styles.over : soon ? styles.soon : ""}`} title={`Срок первого ответа — до ${due} (рабочее время)`}>
      <AlarmClock size={12} aria-hidden="true" />
      {text}
    </span>
  );
}

export function PostponedChip({ until }: { until: string }) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(until);
  const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)) : new Date(until);
  const text = date.toLocaleDateString("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <span className={`${styles.chip} ${styles.postponed}`} title="Сделка отложена до этой даты">
      <CalendarClock size={12} aria-hidden="true" />
      Отложена до {text}
    </span>
  );
}

export const slaRowClass = styles.row;
