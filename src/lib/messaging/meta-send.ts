// Ответ уходит тем же каналом, которым пришёл вопрос. Facebook и Instagram
// разговаривают через один и тот же Send API, отличается только адресат:
// у Facebook это страница, у Instagram — привязанный к ней аккаунт.
//
// Окно в 24 часа проверяется до запроса. Meta вернёт ошибку и сама, но она
// придёт кодом 10 без внятного текста, а менеджеру нужно понимать, почему
// сообщение не ушло, ещё до нажатия кнопки.
const GRAPH = "https://graph.facebook.com/v21.0";

export type SendChannel = "facebook" | "instagram";

export class SendError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: string,
  ) {
    super(message);
  }
}

export function windowOpen(lastIncomingAt: string | null): boolean {
  if (!lastIncomingAt) return false;
  return Date.now() - new Date(lastIncomingAt).getTime() < 24 * 60 * 60 * 1000;
}

function senderId(channel: SendChannel): string {
  const id =
    channel === "instagram"
      ? process.env.META_IG_ACCOUNT_ID
      : process.env.META_PAGE_ID;
  if (!id) throw new SendError(`Канал ${channel} не настроен`, 503);
  return id;
}

export async function sendMetaMessage(
  channel: SendChannel,
  recipientId: string,
  text: string,
): Promise<{ messageId: string | null }> {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) throw new SendError("Токен страницы не задан", 503);
  const response = await fetch(`${GRAPH}/${senderId(channel)}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientId },
      messaging_type: "RESPONSE",
      message: { text },
      access_token: token,
    }),
  });
  const payload = (await response.json().catch(() => null)) as {
    message_id?: string;
    error?: { message?: string; code?: number; error_subcode?: number };
  } | null;
  if (!response.ok || payload?.error) {
    const error = payload?.error;
    // 10 и 551 — закрытое окно и недоступный собеседник: это не наша поломка,
    // менеджеру надо сказать словами, а не показать код.
    if (error?.code === 10 || error?.code === 551)
      throw new SendError(
        "Meta не пропустила сообщение: клиент не писал больше 24 часов. Напишите ему в мессенджере сами или дождитесь его сообщения.",
        409,
        error?.message,
      );
    throw new SendError(
      "Meta не приняла сообщение",
      502,
      error?.message ?? `HTTP ${response.status}`,
    );
  }
  return { messageId: payload?.message_id ?? null };
}
