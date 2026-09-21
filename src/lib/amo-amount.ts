// Суммы лежат в Amo текстом выбранной опции на румынском: «până la €1000 / lună»,
// «peste €20.000», «Achit integral», «altă variantă (scrieți aici): 500». Печатать
// это в сводке дословно нельзя — выходит «până la €1000 / lună / мес», две строки
// и два языка. Опция разбирается и собирается заново в одну короткую.
//
// В карточке сделки поле остаётся сырым: там его правят, и значение должно
// совпадать с тем, что лежит в базе. Короткая форма — только для взгляда:
// карточка воронки, полоса сводки, таблица.
export function shortAmount(value: string | null | undefined) {
  if (!value?.trim()) return null;
  // Множественный выбор Amo склеен через «;»; для взгляда хватает первого.
  let text = value.split(";")[0].trim();
  text = text.replace(/alt[ăa]\s+variant[ăa]\s*\([^)]*\)\s*:?/i, "").trim();
  text = text.replace(/\s*\/\s*lun[ăa]/gi, "");
  if (/^(achit[ăa]?\s+integral|integral)$/i.test(text)) return "всё сразу";
  text = text.replace(/^p[âa]n[ăa]\s+la\s+/i, "до ");
  text = text.replace(/^peste\s+/i, "от ");
  text = text.replace(/\s*[–—-]\s*/g, "–").replace(/–€/g, "–");
  text = text.replace(/^([\d.,\s]+)€$/, "€$1");
  if (!/[€%]/.test(text) && /^[\d.,\s]+$/.test(text)) text = `€${text}`;
  return text.trim() || null;
}

// Ежемесячный платёж без «/мес» читается как разовая сумма. Единица ставится
// только там, где есть число: «всё сразу/мес» — бессмыслица.
export function monthlyAmount(value: string | null | undefined) {
  const short = shortAmount(value);
  if (!short) return null;
  return /\d/.test(short) ? `${short}/мес` : short;
}
