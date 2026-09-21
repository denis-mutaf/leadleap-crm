import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ChannelIcon, channelTitle } from "./channel-icon";
import { Composer } from "./composer";
import { ThreadActions } from "./thread-actions";
import { ThreadOpen } from "./thread-open";
import {
  type Contact,
  type Conversation,
  type Deal,
  type ImportedPhone,
  type Message,
  MESSAGE_LIMIT,
  clock,
  daySeparator,
  replyBlock,
  title,
  unread,
} from "./shared";

// Переписка грузится отдельно от списка и отдельно же показывается: список
// уже на экране, пока сообщения ещё летят. Всё, что нужно треду, берётся
// одним заходом параллельно — цепочка «телефон, потом сделки, потом сделка»
// стоила трёх лишних кругов до базы.
async function loadThread(conversation: Conversation) {
  const supabase = await createClient();
  const errors: string[] = [];
  const contactId = conversation.contact_id;

  const [messageResult, phoneResult, importedPhoneResult, linksResult, directDealsResult] =
    await Promise.all([
      supabase
        .from("messages")
        .select("id, direction, body, sent_at, author_user_id", { count: "exact" })
        .eq("conversation_id", conversation.id)
        .order("sent_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(MESSAGE_LIMIT),
      contactId
        ? supabase
            .from("contact_phones")
            .select("phone")
            .eq("contact_id", contactId)
            .order("is_primary", { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      contactId
        ? supabase
            .from("imported_contact_phones")
            .select("contact_id, raw_phone, normalized_phone")
            .eq("contact_id", contactId)
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      contactId
        ? supabase.from("deal_contacts").select("deal_id").eq("contact_id", contactId).limit(50)
        : Promise.resolve({ data: [], error: null }),
      contactId
        ? supabase
            .from("deals")
            .select("id, title, object_text, status, stage_id, updated_at")
            .eq("contact_id", contactId)
            .limit(50)
        : Promise.resolve({ data: [], error: null }),
    ]);

  if (messageResult.error) errors.push(`Сообщения: ${messageResult.error.message}`);
  const messages = ((messageResult.data ?? []) as Message[]).slice().reverse();

  const phone =
    (phoneResult.data as { phone: string } | null)?.phone ??
    (importedPhoneResult.data as ImportedPhone | null)?.normalized_phone ??
    (importedPhoneResult.data as ImportedPhone | null)?.raw_phone ??
    null;

  const dealIds = [
    ...new Set([
      ...((linksResult.data ?? []) as { deal_id: string }[]).map((row) => row.deal_id).filter(Boolean),
      ...((directDealsResult.data ?? []) as { id: string }[]).map((row) => row.id),
    ]),
  ];
  const authorIds = [
    ...new Set(messages.map((item) => item.author_user_id).filter((id): id is string => Boolean(id))),
  ];
  const [dealsResult, authorsResult] = await Promise.all([
    dealIds.length
      ? supabase
          .from("deals")
          .select("id, title, object_text, status, stage_id, updated_at")
          .in("id", dealIds)
          .order("updated_at", { ascending: false })
          .limit(1)
      : Promise.resolve({ data: [], error: null }),
    authorIds.length
      ? supabase.from("profiles").select("id, full_name").in("id", authorIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (dealsResult.error) errors.push(`Сделки контакта: ${dealsResult.error.message}`);
  const deal = ((dealsResult.data ?? []) as Deal[])[0] ?? null;
  const authors = new Map(
    ((authorsResult.data ?? []) as { id: string; full_name: string }[]).map((item) => [
      item.id,
      item.full_name,
    ]),
  );

  return { messages, messageTotal: messageResult.count ?? 0, phone, deal, authors, errors };
}

export async function ThreadPanels({
  conversation,
  contact,
  assignee,
  profileId,
}: {
  conversation: Conversation;
  contact: Contact | undefined;
  assignee: string | null;
  profileId: string;
}) {
  const data = await loadThread(conversation);
  const name = title(conversation, contact);
  const blocked = replyBlock(conversation);

  return (
    <>
      <main className="inbox-thread">
        <header className="inbox-thread-header">
          <span className="inbox-avatar-wrap">
            <span className="inbox-avatar">{name.slice(0, 2).toUpperCase()}</span>
            <span className="inbox-channel-badge">
              <ChannelIcon channel={conversation.channel} size={11} />
            </span>
          </span>
          <div>
            <h2>{name}</h2>
            <p>
              {channelTitle(conversation.channel)}
              {data.phone ? ` · ${data.phone}` : ""}
              {assignee ? ` · ${assignee}` : ""}
            </p>
          </div>
          <ThreadActions
            conversationId={conversation.id}
            unread={unread(conversation)}
            mine={conversation.assigned_to === profileId}
          />
        </header>
        <div className="inbox-messages">
          {data.messages.length === 0 ? (
            <p className="inbox-muted">Сообщений в этом диалоге нет.</p>
          ) : (
            <>
              {data.messageTotal > data.messages.length && (
                <p className="inbox-count">
                  Показаны последние {data.messages.length} из {data.messageTotal} сообщений
                </p>
              )}
              {data.messages.map((message, index) => {
                const previous = data.messages[index - 1];
                const newDay =
                  !previous ||
                  new Date(previous.sent_at).toDateString() !==
                    new Date(message.sent_at).toDateString();
                return (
                  <div key={message.id}>
                    {newDay && <p className="inbox-day">{daySeparator(message.sent_at)}</p>}
                    <article
                      className={`inbox-message ${message.direction === "out" ? "out" : "in"}`}
                    >
                      <p>{message.body || "Вложение или сообщение без текста"}</p>
                      <small>
                        {clock(message.sent_at)}
                        {message.direction === "out" && message.author_user_id
                          ? ` · ${data.authors.get(message.author_user_id) ?? "сотрудник"}`
                          : ""}
                      </small>
                    </article>
                  </div>
                );
              })}
            </>
          )}
        </div>
        <ThreadOpen conversationId={conversation.id} unread={unread(conversation)} />
        <Composer conversationId={conversation.id} disabledReason={blocked} />
      </main>
      <aside className="inbox-context">
        <h2>Контекст</h2>
        {data.errors.length > 0 && (
          <div className="inbox-warning" role="alert">
            <strong>Не всё загрузилось</strong>
            <p>{data.errors.join(" · ")}</p>
          </div>
        )}
        {contact ? (
          <>
            <strong>{contact.full_name}</strong>
            {data.phone && <p>{data.phone}</p>}
          </>
        ) : (
          <div className="inbox-warning">
            <strong>{conversation.display_name ?? "Собеседник из мессенджера"}</strong>
            <p>
              Карточки контакта ещё нет: переписка пришла из{" "}
              {channelTitle(conversation.channel)}.
            </p>
          </div>
        )}
        {data.deal ? (
          <div className="inbox-deal">
            <span>Последняя сделка</span>
            <strong>{data.deal.title || data.deal.object_text || "Без названия"}</strong>
            <small>Статус: {data.deal.status}</small>
            <Link href={`/deals/${data.deal.id}`}>Открыть сделку</Link>
          </div>
        ) : (
          <p className="inbox-muted">Сделки по этому диалогу нет.</p>
        )}
      </aside>
    </>
  );
}
