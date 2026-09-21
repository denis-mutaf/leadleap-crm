import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SendError, sendMetaMessage, windowOpen } from "@/lib/messaging/meta-send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Meta режет текст на 2000 символах; лучше сказать об этом до отправки.
const schema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().trim().min(1).max(2000),
});

export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile || !["manager", "head", "admin"].includes(profile.role))
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Пустое или слишком длинное сообщение" }, { status: 400 });

  const supabase = await createClient();
  // Читаем через клиент пользователя: RLS сама не отдаст чужой диалог.
  const { data: conversation, error } = await supabase
    .from("conversations")
    .select("id, channel, external_thread_id, last_incoming_at")
    .eq("id", parsed.data.conversationId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Диалог недоступен" }, { status: 400 });
  if (!conversation) return NextResponse.json({ error: "Диалог не найден" }, { status: 404 });

  const channel = conversation.channel as string;
  if (channel !== "facebook" && channel !== "instagram")
    return NextResponse.json(
      { error: `Из CRM пока отвечаем только в Facebook и Instagram. Канал «${channel}» подключается отдельно.` },
      { status: 400 },
    );
  if (!windowOpen(conversation.last_incoming_at as string | null))
    return NextResponse.json(
      {
        error:
          "Клиент не писал больше 24 часов — Meta запрещает отвечать в переписку. Позвоните или напишите ему первым из самого мессенджера.",
      },
      { status: 409 },
    );

  let messageId: string | null = null;
  try {
    ({ messageId } = await sendMetaMessage(
      channel,
      conversation.external_thread_id as string,
      parsed.data.body,
    ));
  } catch (sendError) {
    if (sendError instanceof SendError) {
      console.error("meta send failed", sendError.status, sendError.detail);
      return NextResponse.json({ error: sendError.message }, { status: sendError.status });
    }
    console.error("meta send failed", sendError);
    return NextResponse.json({ error: "Не удалось отправить сообщение" }, { status: 502 });
  }

  const sentAt = new Date().toISOString();
  // Эхо того же сообщения прилетит вебхуком с тем же mid — вставка по
  // external_id не даст задвоения.
  const { error: insertError } = await supabase.from("messages").upsert(
    {
      conversation_id: conversation.id,
      direction: "out",
      body: parsed.data.body,
      external_id: messageId,
      author_user_id: profile.id,
      sent_at: sentAt,
      raw: { sent_from: "crm", message_id: messageId },
    },
    { onConflict: "conversation_id,external_id", ignoreDuplicates: true },
  );
  if (insertError) {
    // Сообщение у клиента уже есть, значит это не ошибка отправки: пишем в лог
    // и отвечаем успехом, иначе менеджер нажмёт «отправить» второй раз.
    console.error("inbox send: message not stored", insertError.message);
  }
  await supabase
    .from("conversations")
    .update({ last_read_at: sentAt, unread_count: 0 })
    .eq("id", conversation.id);
  return NextResponse.json({ ok: true, sentAt, messageId });
}
