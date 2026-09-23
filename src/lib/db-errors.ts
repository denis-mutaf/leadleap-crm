// Человеческий текст ошибки базы для интерфейса. Функции Postgres отвечают
// по-английски и техническим языком — пользователю это показывать нельзя.
// Сюда попадает всё, что пришло из supabase-js ({ message, code }) или Error.

// Точные сообщения из raise exception в функциях базы.
const EXACT: Record<string, string> = {
  "Choose a loss reason": "Выберите причину отказа",
  "Loss reason is only valid for refusal": "Причина отказа нужна только для этапа «Отказ»",
  "Choose a project": "Выберите проект",
  "Choose an active open stage": "Выберите открытый этап",
  "Choose an active stage": "Выберите этап",
  "Choose an active owner": "Выберите ответственного",
  "Owner is not assignable": "Этого ответственного нельзя назначить",
  "Choose an active source": "Выберите источник",
  "Choose an active task assignee": "Выберите исполнителя задачи",
  "Choose an active task type": "Выберите тип задачи",
  "Task needs a title and future date": "У задачи нужны название и дата в будущем",
  "Task completion requires a result": "Чтобы закрыть задачу, напишите результат",
  "Deal unavailable": "Сделка недоступна — возможно, её удалили",
  "Invalid phone number": "Проверьте номер телефона",
  "Selected contact does not match this phone": "Выбранный контакт не совпадает с этим телефоном",
  "Name and deal title are required": "Укажите имя и название сделки",
  "Invalid project selection": "Проверьте выбор проекта",
  "Invalid tag selection": "Проверьте выбор меток",
  "Tag is not active": "Метка скрыта — выберите другую",
  "Tag not found": "Метка не найдена",
  "Both tags must be active": "Обе метки должны быть активны",
  "Choose two different tags": "Выберите две разные метки",
  "Invalid qualification": "Проверьте квалификацию",
  "Qualification tag is missing": "Отметьте КВАЛ или неквал",
  "Qualification tags are required by the pipeline": "Отметьте КВАЛ или неквал",
  "Active CRM record cannot reference a deleted contact": "Контакт в корзине — сначала восстановите его",
  "CRM record cannot be deleted while active deals exist": "Нельзя удалить: у контакта есть активная сделка",
  "CRM record operation is not permitted": "Недостаточно прав или запись уже изменилась",
  "CRM trash access is not permitted": "Нет доступа к корзине",
  "CRM trash purge is not permitted": "Нет прав очищать корзину",
  "field order changed; refresh and retry": "Порядок полей уже изменили — обновите страницу",
  "admin role required": "Нужны права администратора",
  "contact custom field conflict requires explicit value selection": "Выберите, какое значение поля оставить",
  "Not allowed": "Недостаточно прав",
};

// Технические ошибки сети и базы — по фрагменту текста или коду.
const PARTIAL: Array<[RegExp, string]> = [
  [/statement timeout|canceling statement/i, "Сервер не успел ответить. Попробуйте ещё раз"],
  [/Failed to fetch|NetworkError|Load failed|fetch failed/i, "Нет связи с сервером. Проверьте интернет и повторите"],
  [/JWT expired|invalid JWT|not authenticated/i, "Сессия истекла — войдите заново"],
  [/duplicate key|already exists/i, "Такая запись уже есть"],
  [/violates foreign key/i, "Связанная запись не найдена — обновите страницу"],
  [/permission denied|row-level security/i, "Недостаточно прав"],
];

const CODES: Record<string, string> = {
  "57014": "Сервер не успел ответить. Попробуйте ещё раз",
  "42501": "Недостаточно прав",
  "23505": "Такая запись уже есть",
};

/** Текст для toast. fallback — что показать, если ошибка незнакомая. */
export function dbErrorText(error: unknown, fallback = "Не получилось. Попробуйте ещё раз"): string {
  if (!error) return fallback;
  const record = typeof error === "object" ? (error as { message?: unknown; code?: unknown }) : null;
  const message = typeof error === "string" ? error : typeof record?.message === "string" ? record.message : "";
  const code = typeof record?.code === "string" ? record.code : "";
  const trimmed = message.trim();
  if (EXACT[trimmed]) return EXACT[trimmed];
  // Сообщения базы, которые уже написаны по-русски, показываем как есть.
  if (/[а-яё]/i.test(trimmed) && !/[a-z]{4,}\s[a-z]{4,}/i.test(trimmed)) return trimmed;
  for (const [pattern, text] of PARTIAL) if (pattern.test(trimmed)) return text;
  if (code && CODES[code]) return CODES[code];
  return fallback;
}
