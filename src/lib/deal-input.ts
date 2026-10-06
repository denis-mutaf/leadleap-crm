// Ввод в карточке сделки: справочники и проверки. Те же правила считает база
// (validate_deal_user_input, миграция 20261006160000): клиент подсказывает заранее,
// база не даёт обойти.

export const ROOM_OPTIONS = [
  { value: "1", label: "1 комната" },
  { value: "2", label: "2 комнаты" },
  { value: "3", label: "3 комнаты" },
  { value: "4", label: "4 и больше" },
];

export const RESIDENCY_OPTIONS = [
  { value: "local", label: "Местный" },
  { value: "diaspora", label: "Диаспора" },
];

export const MONTHLY_PAYMENT_PRESETS = ["до 1000", "1000-1500", "1500-2500", "от 2500"];
export const DOWN_PAYMENT_PRESETS = ["до 10000", "10000-20000", "от 20000", "всё сразу"];

const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const MONTH_VALUE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isMonthValue = (value: string) => MONTH_VALUE.test(value.trim());

/** «2026-12» → «декабрь 2026»; всё остальное (старые тексты из Amo) показываем как есть. */
export function formatMonth(value: string): string {
  const text = value.trim();
  if (!MONTH_VALUE.test(text)) return value;
  return `${MONTHS[Number(text.slice(5)) - 1]} ${text.slice(0, 4)}`;
}

const compact = (text: string) =>
  text
    .replace(/[\s€]|eur/gi, "")
    .replace(/[–—]/g, "-")
    .replace(/,/g, ".")
    .toLowerCase();

function isRange(text: string) {
  const match = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(text);
  return match ? Number(match[1]) <= Number(match[2]) : null;
}

/** Платёж и взнос: число, диапазон, «до N», «от N», процент или «всё сразу». */
export function amountError(raw: string, label: string): string | null {
  const text = compact(raw.trim());
  if (!text) return null;
  const percent = /^(\d{1,3})%$/.exec(text);
  if (percent) return Number(percent[1]) <= 100 ? null : `${label}: процент не больше 100`;
  if (text === "всёсразу" || text === "всесразу") return null;
  if (/^(до|от)?\d+(\.\d+)?$/.test(text)) return null;
  const range = isRange(text);
  if (range === true) return null;
  if (range === false) return `${label}: начало диапазона больше конца`;
  return `${label} — число или диапазон, например ${label === "Первый взнос" ? "10000 или 10000-20000" : "800 или 800-1200"}`;
}

/** Этаж и площадь: неотрицательное число или диапазон. */
export function sizeError(raw: string, label: string): string | null {
  const text = compact(raw.trim()).replace(/м²|м2|m2|кв\.?м/g, "");
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) return null;
  const range = isRange(text);
  if (range === true) return null;
  if (range === false) return `${label}: начало диапазона больше конца`;
  return `${label} — неотрицательное число или диапазон, например ${label === "Этаж" ? "3-5" : "55-70"}`;
}

export function budgetError(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const value = Number(text.replace(",", "."));
  if (!Number.isFinite(value)) return "Бюджет — число";
  if (value < 0) return "Бюджет не может быть отрицательным";
  return null;
}

export function monthError(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  return isMonthValue(text) ? null : "Срок покупки — выберите месяц";
}
