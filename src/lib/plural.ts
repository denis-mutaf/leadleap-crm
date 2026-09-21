// «1 записей» и «2 записей» читаются как недоделка. Русский счёт требует три
// формы, и на экранах со счётчиками они нужны все: 1 запись, 2 записи, 5 записей.
export function plural(count: number, one: string, few: string, many: string) {
  const n = Math.abs(count) % 100;
  if (n >= 11 && n <= 14) return many;
  const last = n % 10;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

export function countWord(count: number, one: string, few: string, many: string) {
  return `${count} ${plural(count, one, few, many)}`;
}
