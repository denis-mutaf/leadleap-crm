// Рабочие часы отдела: настройка settings.working_hours.
// Формат совпадает с функциями базы add_working_minutes / working_minutes_between.

export type WorkingSlot = { start: string; end: string };
export type WorkingHours = {
  tz: string;
  // Ключи — ISO-дни недели "1" (пн) … "7" (вс); null — выходной.
  days: Record<string, WorkingSlot | null>;
  // Даты YYYY-MM-DD, в которые отдел не работает.
  holidays: string[];
};

export const WEEK_DAYS = [
  { key: "1", label: "Понедельник" },
  { key: "2", label: "Вторник" },
  { key: "3", label: "Среда" },
  { key: "4", label: "Четверг" },
  { key: "5", label: "Пятница" },
  { key: "6", label: "Суббота" },
  { key: "7", label: "Воскресенье" },
] as const;

export const DEFAULT_SLA_MINUTES = 30;
export const MAX_SLA_MINUTES = 10080;

export const DEFAULT_WORKING_HOURS: WorkingHours = {
  tz: "Europe/Chisinau",
  days: {
    "1": { start: "09:00", end: "18:00" },
    "2": { start: "09:00", end: "18:00" },
    "3": { start: "09:00", end: "18:00" },
    "4": { start: "09:00", end: "18:00" },
    "5": { start: "09:00", end: "18:00" },
    "6": null,
    "7": null,
  },
  holidays: [],
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Из базы приходит произвольный jsonb: берём только то, что понимаем, остальное — по умолчанию.
export function parseWorkingHours(value: unknown): WorkingHours {
  const raw = (value && typeof value === "object" ? value : {}) as { tz?: unknown; days?: unknown; holidays?: unknown };
  const days: WorkingHours["days"] = {};
  const source = (raw.days && typeof raw.days === "object" ? raw.days : null) as Record<string, unknown> | null;
  for (const { key } of WEEK_DAYS) {
    const slot = source?.[key] as { start?: unknown; end?: unknown } | null | undefined;
    if (source === null) days[key] = DEFAULT_WORKING_HOURS.days[key];
    else if (slot && typeof slot.start === "string" && typeof slot.end === "string" && TIME.test(slot.start) && TIME.test(slot.end)) {
      days[key] = { start: slot.start.slice(0, 5), end: slot.end.slice(0, 5) };
    } else days[key] = null;
  }
  const holidays = Array.isArray(raw.holidays) ? raw.holidays.filter((item): item is string => typeof item === "string" && DATE.test(item)) : [];
  return {
    tz: typeof raw.tz === "string" && raw.tz ? raw.tz : DEFAULT_WORKING_HOURS.tz,
    days,
    holidays: [...new Set(holidays)].sort(),
  };
}

export function parseSlaMinutes(value: unknown): number {
  const minutes = (value as { minutes?: unknown } | null)?.minutes;
  return typeof minutes === "number" && Number.isInteger(minutes) && minutes >= 1 ? minutes : DEFAULT_SLA_MINUTES;
}

// Текст первой ошибки или null. Те же правила держит триггер в базе.
export function workingHoursError(hours: WorkingHours, minutes: number): string | null {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_SLA_MINUTES) return `Срок первого ответа — целое число минут от 1 до ${MAX_SLA_MINUTES}`;
  for (const { key, label } of WEEK_DAYS) {
    const slot = hours.days[key];
    if (!slot) continue;
    if (!TIME.test(slot.start) || !TIME.test(slot.end)) return `${label}: укажите время начала и конца`;
    if (slot.end <= slot.start) return `${label}: конец рабочего дня должен быть позже начала`;
  }
  return null;
}
