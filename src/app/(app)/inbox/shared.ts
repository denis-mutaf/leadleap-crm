import { channelTitle } from "./channel-icon";

export const PAGE_SIZE = 50;
export const MESSAGE_LIMIT = 100;
// Meta разрешает свободный ответ 24 часа после сообщения клиента.
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const SENDABLE = new Set(["facebook", "instagram"]);
export const VIEWS = ["all", "unanswered", "mine"] as const;
export type View = (typeof VIEWS)[number];

export const COLUMNS =
  "id, channel, contact_id, display_name, last_message_at, last_direction, last_body, last_incoming_at, last_read_at, assigned_to";

// Имя контакта и имя ответственного приезжают вместе со строкой диалога.
// Отдельными запросами это стоило двух лишних кругов до базы на каждый
// показ списка — заметнее всего при переключении диалога.
export const COLUMNS_JOINED = `${COLUMNS}, contact:contacts(id, full_name), assignee:profiles(id, full_name)`;

export type Conversation = {
  id: string;
  channel: string;
  contact_id: string | null;
  display_name: string | null;
  last_message_at: string | null;
  last_direction: "in" | "out" | null;
  last_body: string | null;
  last_incoming_at: string | null;
  last_read_at: string | null;
  assigned_to: string | null;
};
export type Message = {
  id: string;
  direction: "in" | "out";
  body: string | null;
  sent_at: string;
  author_user_id: string | null;
};
export type Contact = { id: string; full_name: string };
export type ConversationRow = Conversation & {
  contact: Contact | null;
  assignee: { id: string; full_name: string } | null;
};
export type Deal = {
  id: string;
  title: string | null;
  object_text: string | null;
  status: string;
  stage_id: string;
};
export type ImportedPhone = {
  contact_id: string;
  raw_phone: string;
  normalized_phone: string | null;
};

export function time(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  const now = new Date();
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)} мин`;
  if (date.toDateString() === now.toDateString())
    return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Chisinau", hour: "2-digit", minute: "2-digit" }).format(date);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "вчера";
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Chisinau", day: "numeric", month: "short" }).format(date);
}

export function clock(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Chisinau", hour: "2-digit", minute: "2-digit" }).format(
    new Date(value),
  );
}

export function daySeparator(value: string) {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return "Сегодня";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Вчера";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Chisinau",
    day: "numeric",
    month: "long",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  }).format(date);
}

// «Ждёт 3 ч» отвечает на единственный вопрос, который задаёт руководитель,
// глядя в инбокс: сколько мы уже молчим.
export function waiting(value: string | null) {
  if (!value) return null;
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 60) return `ждёт ${Math.max(1, minutes)} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `ждёт ${hours} ч`;
  const days = Math.floor(hours / 24);
  return `ждёт ${days} дн`;
}

export function title(conversation: Conversation, contact: Contact | undefined) {
  return contact?.full_name ?? conversation.display_name ?? "Без имени";
}

export function unanswered(conversation: Conversation) {
  return conversation.last_direction === "in";
}

// Непрочитано — не то же, что без ответа: диалог могли открыть, прочитать и
// намеренно отложить. Жирным горит только по-настоящему непросмотренное.
export function unread(conversation: Conversation) {
  if (conversation.last_direction !== "in") return false;
  if (!conversation.last_read_at) return true;
  if (!conversation.last_message_at) return false;
  return new Date(conversation.last_message_at) > new Date(conversation.last_read_at);
}

export function replyBlock(conversation: Conversation): string | null {
  if (!SENDABLE.has(conversation.channel))
    return `Отвечать из CRM можно в Facebook и Instagram. Канал «${channelTitle(conversation.channel)}» так не работает: ответьте звонком или в самом канале.`;
  const last = conversation.last_incoming_at;
  if (!last || Date.now() - new Date(last).getTime() >= REPLY_WINDOW_MS)
    return "Клиент не писал больше 24 часов — Meta закрыла переписку для ответа. Позвоните ему или напишите первым из мессенджера.";
  return null;
}

// PostgREST разбирает ilike как часть фильтра, поэтому запятые, скобки и
// собственные подстановочные знаки из запроса убираются.
export function safeQuery(value: string) {
  return value.replace(/[%_,()*]/g, " ").trim();
}
