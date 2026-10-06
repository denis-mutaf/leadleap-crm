// Телефон в интерфейсе. normalizePhone — копия SQL-функции normalize_phone
// (миграция 20261006120000): по нему клиент заранее сравнивает номер с уже
// записанными и показывает понятную ошибку, а не ответ базы.

export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("00") && digits.length > 2) return `+${digits.slice(2)}`;
  if (digits.length === 8) return `+373${digits}`;
  if (digits.length === 9 && digits.startsWith("0")) return `+373${digits.slice(1)}`;
  return `+${digits}`;
}

/** Текст ошибки для введённого номера или null, если номер годится. */
export function phoneError(raw: string): string | null {
  const normalized = normalizePhone(raw);
  if (!normalized) return "Введите номер телефона";
  const digits = normalized.slice(1);
  if (digits.length < 8) return `В номере ${digits.length} ${digitsWord(digits.length)} — нужно минимум 8`;
  if (digits.length > 15) return "В номере больше 15 цифр";
  if (digits.startsWith("373") && digits.length !== 11) {
    const local = digits.length - 3;
    return `Для номера +373 нужно ровно 8 цифр после кода, сейчас ${local}`;
  }
  return null;
}

function digitsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "цифра";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "цифры";
  return "цифр";
}
