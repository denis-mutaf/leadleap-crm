import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";

const PAGE_SIZE = 50;
const MESSAGE_LIMIT = 100;

type SearchParams = Promise<{ conversation?: string; page?: string }>;
type Conversation = {
  id: string;
  channel: string;
  contact_id: string | null;
  last_message_at: string | null;
  unread_count: number;
};
type Message = {
  id: string;
  direction: "in" | "out";
  body: string | null;
  sent_at: string;
  author_user_id: string | null;
};
type Contact = { id: string; full_name: string };
type Deal = {
  id: string;
  title: string | null;
  object_text: string | null;
  status: string;
  stage_id: string;
};
type ImportedPhone = {
  contact_id: string;
  raw_phone: string;
  normalized_phone: string | null;
};

function time(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "—";
}

function channelName(channel: string) {
  return (
    {
      whatsapp: "WhatsApp",
      viber: "Viber",
      instagram: "Instagram",
      facebook: "Facebook",
      web_form: "Форма сайта",
      lead_ads: "Реклама",
      manual: "Вручную",
    }[channel] ?? channel
  );
}

async function loadInbox(selectedId: string | undefined, page: number) {
  const supabase = await createClient();
  const errors: string[] = [];
  const countResult = await supabase
    .from("conversations")
    .select("id", { count: "exact", head: true });
  if (countResult.error)
    errors.push(`Количество диалогов: ${countResult.error.message}`);
  const total = countResult.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = total === 0 ? 1 : Math.min(page, totalPages);
  const offset = (safePage - 1) * PAGE_SIZE;
  const conversationResult =
    offset < total
      ? await supabase
          .from("conversations")
          .select("id, channel, contact_id, last_message_at, unread_count")
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .order("id", { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1)
      : { data: [], error: null };
  if (conversationResult.error)
    errors.push(`Диалоги: ${conversationResult.error.message}`);
  const conversations = (conversationResult.data ?? []) as Conversation[];
  let selected = conversations.find((item) => item.id === selectedId);
  if (!selected && selectedId) {
    const selectedResult = await supabase
      .from("conversations")
      .select("id, channel, contact_id, last_message_at, unread_count")
      .eq("id", selectedId)
      .maybeSingle();
    if (selectedResult.error)
      errors.push(`Выбранный диалог: ${selectedResult.error.message}`);
    selected =
      (selectedResult.data as Conversation | null | undefined) ?? undefined;
  }
  if (!selectedId) selected = conversations[0];
  const messageConversationId = selected?.id;
  const messageResult = messageConversationId
    ? await supabase
        .from("messages")
        .select("id, direction, body, sent_at, author_user_id", {
          count: "exact",
        })
        .eq("conversation_id", messageConversationId)
        .order("sent_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(MESSAGE_LIMIT)
    : { data: [], count: 0, error: null };
  if (messageResult.error)
    errors.push(`Сообщения: ${messageResult.error.message}`);
  const visibleConversations =
    selected && !conversations.some((item) => item.id === selected.id)
      ? [...conversations, selected]
      : conversations;
  const ids = visibleConversations
    .map((item) => item.contact_id)
    .filter((id): id is string => Boolean(id));
  const contactsResult = ids.length
    ? await supabase.from("contacts").select("id, full_name").in("id", ids)
    : { data: [], error: null };
  if (contactsResult.error)
    errors.push(`Контакты: ${contactsResult.error.message}`);
  const contactMap = new Map(
    ((contactsResult.data ?? []) as Contact[]).map((item) => [item.id, item]),
  );
  let phone: string | null = null;
  let deal: Deal | null = null;
  if (selected?.contact_id) {
    const phoneResult = await supabase
      .from("contact_phones")
      .select("phone")
      .eq("contact_id", selected.contact_id)
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (phoneResult.error) errors.push(`Телефон: ${phoneResult.error.message}`);
    else phone = phoneResult.data?.phone ?? null;
    if (!phone) {
      const importedPhoneResult = await supabase
        .from("imported_contact_phones")
        .select("contact_id, raw_phone, normalized_phone")
        .eq("contact_id", selected.contact_id)
        .limit(1)
        .maybeSingle();
      if (importedPhoneResult.error)
        errors.push(
          `Импортированный телефон: ${importedPhoneResult.error.message}`,
        );
      else
        phone =
          (importedPhoneResult.data as ImportedPhone | null)
            ?.normalized_phone ??
          (importedPhoneResult.data as ImportedPhone | null)?.raw_phone ??
          null;
    }
    const linksResult = await supabase
      .from("deal_contacts")
      .select("deal_id")
      .eq("contact_id", selected.contact_id)
      .limit(50);
    if (linksResult.error)
      errors.push(`Связи сделок: ${linksResult.error.message}`);
    const dealIds = (linksResult.data ?? [])
      .map((row) => row.deal_id)
      .filter(Boolean);
    const directDealsResult = await supabase
      .from("deals")
      .select("id, title, object_text, status, stage_id, updated_at")
      .eq("contact_id", selected.contact_id)
      .limit(50);
    if (directDealsResult.error)
      errors.push(`Прямые сделки контакта: ${directDealsResult.error.message}`);
    const allDealIds = [
      ...new Set([
        ...dealIds,
        ...(directDealsResult.data ?? []).map((item) => item.id),
      ]),
    ];
    if (allDealIds.length) {
      const dealsResult = await supabase
        .from("deals")
        .select("id, title, object_text, status, stage_id, updated_at")
        .in("id", allDealIds)
        .order("updated_at", { ascending: false })
        .limit(1);
      if (dealsResult.error)
        errors.push(`Сделки контакта: ${dealsResult.error.message}`);
      else deal = (dealsResult.data?.[0] as Deal | undefined) ?? null;
    }
  }
  return {
    conversations,
    total,
    selected,
    contactMap,
    phone,
    deal,
    messages: messageConversationId
      ? ((messageResult.data ?? []) as Message[]).reverse()
      : [],
    messageTotal: messageResult.count ?? 0,
    errors,
    page: safePage,
  };
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role === "builder") redirect("/reports");
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const data = await loadInbox(params.conversation, page);
  const selected = data.selected;
  const selectedContact = selected?.contact_id
    ? data.contactMap.get(selected.contact_id)
    : undefined;
  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const safePage = data.page;

  return (
    <section className="inbox-page">
      <header className="inbox-header">
        <div>
          <p className="inbox-eyebrow">Коммуникации</p>
          <h1>
            Инбокс <span>{data.total}</span>
          </h1>
        </div>
        <p className="inbox-readonly">Только просмотр</p>
      </header>
      {data.errors.length > 0 && (
        <div className="inbox-alert" role="alert">
          Не всё удалось загрузить: {data.errors.join(" · ")}
        </div>
      )}
      <div className="inbox-toolbar">
        <span className="inbox-toolbar-title">Все диалоги</span>
      </div>
      <div className="inbox-grid">
        <aside className="inbox-list" aria-label="Диалоги">
          {data.conversations.length === 0 ? (
            <div className="inbox-empty">
              <strong>
                {data.total ? "Страница пуста" : "Диалогов пока нет"}
              </strong>
              <span>
                {data.total
                  ? "Выберите другую страницу."
                  : "Здесь появятся входящие обращения, когда подключённый канал доставит их в CRM."}
              </span>
            </div>
          ) : (
            data.conversations.map((conversation) => {
              const contact = conversation.contact_id
                ? data.contactMap.get(conversation.contact_id)
                : undefined;
              return (
                <Link
                  className={`inbox-row ${selected?.id === conversation.id ? "selected" : ""}`}
                  href={`/inbox?conversation=${conversation.id}&page=${page}`}
                  key={conversation.id}
                >
                  <span className="inbox-avatar">
                    {(contact?.full_name ?? "?").slice(0, 2).toUpperCase()}
                  </span>
                  <span className="inbox-row-main">
                    <strong>{contact?.full_name ?? "Контакт не найден"}</strong>
                    <small>
                      {channelName(conversation.channel)} ·{" "}
                      {time(conversation.last_message_at)}
                    </small>
                  </span>
                  {conversation.unread_count > 0 && (
                    <i
                      className="inbox-unread"
                      aria-label={`${conversation.unread_count} непрочитанных`}
                    />
                  )}
                </Link>
              );
            })
          )}
          {data.total > PAGE_SIZE && (
            <nav className="inbox-pagination" aria-label="Страницы">
              <span>
                {data.total === 0
                  ? "0"
                  : `${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, data.total)}`}{" "}
                из {data.total}
              </span>
              {page > 1 && <Link href={`/inbox?page=${page - 1}`}>Назад</Link>}
              {page < pages && (
                <Link href={`/inbox?page=${page + 1}`}>Далее</Link>
              )}
            </nav>
          )}
        </aside>
        <main className="inbox-thread">
          {!selected ? (
            <div className="inbox-thread-empty">
              <span className="inbox-empty-mark">↗</span>
              <h2>Выберите диалог</h2>
              <p>Переписка появится здесь после выбора обращения из списка.</p>
            </div>
          ) : (
            <>
              <header className="inbox-thread-header">
                <span className="inbox-avatar">
                  {(selectedContact?.full_name ?? "?")
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
                <div>
                  <h2>{selectedContact?.full_name ?? "Контакт не найден"}</h2>
                  <p>
                    {channelName(selected.channel)}
                    {data.phone ? ` · ${data.phone}` : ""}
                  </p>
                </div>
              </header>
              <div className="inbox-messages">
                {data.messages.length === 0 ? (
                  <p className="inbox-muted">Сообщений в этом диалоге нет.</p>
                ) : (
                  data.messages.map((message) => (
                    <article
                      className={`inbox-message ${message.direction === "out" ? "out" : "in"}`}
                      key={message.id}
                    >
                      <p>
                        {message.body || "Вложение или сообщение без текста"}
                      </p>
                      <small>
                        {time(message.sent_at)} ·{" "}
                        {message.direction === "out" ? "исходящее" : "входящее"}
                      </small>
                    </article>
                  ))
                )}
                <p className="inbox-count">
                  Показано {data.messages.length} из {data.messageTotal}{" "}
                  сообщений
                </p>
              </div>
            </>
          )}
        </main>
        <aside className="inbox-context">
          <h2>Контекст</h2>
          {!selected ? (
            <p className="inbox-muted">
              Выберите диалог, чтобы увидеть доступный контакт и сделку.
            </p>
          ) : (
            <>
              {selectedContact ? (
                <>
                  <strong>{selectedContact.full_name}</strong>
                  {data.phone && <p>{data.phone}</p>}
                </>
              ) : (
                <div className="inbox-warning">
                  <strong>Контакт не найден</strong>
                  <p>Данные контакта недоступны или ещё не связаны.</p>
                </div>
              )}
              {data.deal && (
                <div className="inbox-deal">
                  <span>Последняя сделка</span>
                  <strong>
                    {data.deal.title || data.deal.object_text || "Без названия"}
                  </strong>
                  <small>Статус: {data.deal.status}</small>
                  <Link href={`/deals/${data.deal.id}`}>Открыть сделку</Link>
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
