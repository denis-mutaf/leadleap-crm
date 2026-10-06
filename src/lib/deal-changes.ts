// Изменения сделки для людей: «Поле: было → стало». Одна таблица названий и один
// разбор значений на ленту карточки и на журнал /settings/audit.
import { formatMonth, isMonthValue } from "@/lib/deal-input";

export type FieldChange = { was: unknown; now: unknown };

// Поля, которые человек видит и правит в карточке. Всё остальное в audit_log
// (этап и статус — их показывает лента переходов, служебные отметки, атрибуция)
// в ленту не попадает.
export const DEAL_FIELD_LABELS: Record<string, string> = {
  owner_id: "Ответственный",
  source_id: "Источник",
  title: "Название сделки",
  object_text: "Объект",
  budget: "Бюджет",
  budget_currency: "Валюта бюджета",
  payment: "Способ оплаты",
  horizon: "Срок покупки",
  residency: "В стране",
  rooms: "Комнатность",
  purpose: "Цель покупки",
  postponed_until: "Касание",
  lost_reason_id: "Причина отказа",
  lost_comment: "Комментарий к отказу",
  construction_stage: "Этап строительства",
  down_payment_text: "Первый взнос",
  monthly_payment_text: "Ежемесячный платёж",
  purchase_timing_text: "Срок покупки",
  residency_detail: "В стране",
  desired_area_text: "Площадь, м²",
  desired_floor_text: "Этаж",
  wishes: "Пожелания",
  rooms_text: "Комнатность",
  tags: "Метки",
  project: "Проект",
};

const ENUM_LABELS: Record<string, Record<string, string>> = {
  payment: { cash: "Наличные", mortgage: "Ипотека", installment: "Рассрочка" },
  horizon: {},
  residency: { local: "Местный", diaspora: "Диаспора" },
  purpose: { living: "Для жизни", investment: "Инвестиция" },
};

const ID_FIELDS = new Set(["owner_id", "source_id", "lost_reason_id"]);
const CUSTOM_PREFIX = "custom:";

export type ChangeLine = { key: string; label: string; was: string | null; now: string | null; kind: "change" | "added" | "removed" };

export const isFeedField = (key: string) => key in DEAL_FIELD_LABELS || key.startsWith(CUSTOM_PREFIX);

function show(key: string, value: unknown, names: Record<string, string>): string | null {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value);
  if (ID_FIELDS.has(key)) return names[text] ?? "—";
  if (key === "purchase_timing_text" && isMonthValue(text)) return formatMonth(text);
  if (key === "budget") return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Number(text));
  if (key === "postponed_until") return new Date(text).toLocaleDateString("ru-RU", { timeZone: "Europe/Chisinau" });
  return ENUM_LABELS[key]?.[text] ?? text;
}

/** Разворачивает запись audit_log в строки «поле: было → стало» (только поля карточки). */
export function describeChanges(changes: unknown, names: Record<string, string>): ChangeLine[] {
  if (!changes || typeof changes !== "object") return [];
  const lines: ChangeLine[] = [];
  for (const [key, raw] of Object.entries(changes as Record<string, unknown>)) {
    if (!isFeedField(key) || !raw || typeof raw !== "object") continue;
    const change = raw as FieldChange;
    const label = key.startsWith(CUSTOM_PREFIX) ? key.slice(CUSTOM_PREFIX.length) : DEAL_FIELD_LABELS[key];
    const was = show(key, change.was, names);
    let now = show(key, change.now, names);
    // Ответственный «пусто» — это общий котёл, а не «ничего».
    const empty = key === "owner_id" ? "Общий котёл" : null;
    const wasShown = was ?? empty;
    if (key === "owner_id") now = now ?? empty;
    if (key === "tags" || key === "project") {
      if (was && !now) lines.push({ key, label, was, now: null, kind: "removed" });
      else if (now && !was) lines.push({ key, label, was: null, now, kind: "added" });
      else lines.push({ key, label, was, now, kind: "change" });
      continue;
    }
    if (wasShown === now) continue;
    lines.push({ key, label, was: wasShown, now, kind: "change" });
  }
  return lines;
}

/** Одна строка для ленты и журнала: «Бюджет: 50 000 → 60 000», «Метка добавлена: КВАЛ». */
export function changeText(line: ChangeLine): string {
  if (line.key === "tags") return line.kind === "added" ? `Метка добавлена: ${line.now}` : line.kind === "removed" ? `Метка снята: ${line.was}` : `Метки: ${line.was ?? "—"} → ${line.now ?? "—"}`;
  if (line.key === "project" && line.kind === "added") return `Проект: ${line.now}`;
  if (line.key === "project" && line.kind === "removed") return `Проект снят: ${line.was}`;
  return `${line.label}: ${line.was ?? "—"} → ${line.now ?? "—"}`;
}
