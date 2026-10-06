// Даты касания по отложенной сделке: календарный день отдела (Europe/Chisinau), "YYYY-MM-DD".

const TIME_ZONE = "Europe/Chisinau";
const pad = (value: number) => String(value).padStart(2, "0");
const iso = (date: Date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

// Сегодняшний день отдела (Кишинёв), а не браузера: дата касания — календарный день отдела.
export function todayInDepartment(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date());
}

function fromIso(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function addDays(value: string, days: number): string {
  const date = fromIso(value);
  date.setUTCDate(date.getUTCDate() + days);
  return iso(date);
}

// Через месяц: тот же день следующего месяца, а 31-е не перескакивает в послезавтра.
export function addMonth(value: string): string {
  const date = fromIso(value);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return iso(date);
}

export function postponedLabel(value: string): string {
  const date = fromIso(value);
  const sameYear = date.getUTCFullYear() === fromIso(todayInDepartment()).getUTCFullYear();
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) })
    .format(date)
    .replace(/\.(?=\s|$)/g, "");
}
