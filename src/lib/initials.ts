// Инициалы для аватара: первые буквы первых двух слов, только буквы и цифры.
// Раньше брали первые два символа строки, и имя «T<…» превращалось в аватар «T<».
export function initialsOf(name: string | null | undefined, fallback = "?"): string {
  const letters = (name ?? "")
    .split(/\s+/)
    .map((part) => /[\p{L}\p{N}]/u.exec(part)?.[0] ?? "")
    .filter(Boolean)
    .slice(0, 2)
    .join("");
  return letters ? letters.toUpperCase() : fallback;
}
