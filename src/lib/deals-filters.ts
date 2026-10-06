// Фильтры воронки живут в cookie: менеджер вышел в «Задачи» и вернулся в
// «Сделки» — доска осталась такой же. Cookie читает серверная страница
// (редирект на прежний адрес), пишет клиентский RememberDealsFilters.
export const DEALS_FILTERS_COOKIE = "crm-deals-filters";

// Ключи адреса воронки, которые запоминаем. Всё прочее (reset и т. п.) — нет.
export const DEALS_FILTER_KEYS = ["owner", "project", "tag", "source", "flag", "sort", "mine", "from", "to"] as const;

// Несколько меток в одном параметре через «.»: запятая в cookie недопустима.
export const TAG_SEPARATOR = ".";

const SAFE_VALUE = /^[A-Za-z0-9._-]{1,400}$/;

/** Строка запроса только из известных ключей; чужие и пустые значения отбрасываются. */
export function dealsFilterString(source: (key: string) => string | null | undefined): string {
  const pairs: string[] = [];
  for (const key of DEALS_FILTER_KEYS) {
    const value = source(key);
    if (value && SAFE_VALUE.test(value)) pairs.push(`${key}=${value}`);
  }
  return pairs.join("&");
}

export function splitTags(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(TAG_SEPARATOR)
    .map((item) => item.trim())
    .filter((item) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item));
}

/** Из адреса — в сохранённую строку (в браузере). */
export function readSavedDealsFilters(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.split("; ").find((item) => item.startsWith(`${DEALS_FILTERS_COOKIE}=`));
  const raw = match ? match.slice(DEALS_FILTERS_COOKIE.length + 1) : "";
  const params = new URLSearchParams(raw);
  return dealsFilterString((key) => params.get(key));
}

export function writeSavedDealsFilters(value: string) {
  document.cookie = value
    ? `${DEALS_FILTERS_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`
    : `${DEALS_FILTERS_COOKIE}=; path=/; max-age=0; samesite=lax`;
}
