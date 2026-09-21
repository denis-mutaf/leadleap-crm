import Link from "next/link";
import { redirect } from "next/navigation";
import { Inbox, MessageCircle, Phone, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { EmptyState } from "@/components/crm/empty-state";
import styles from "./inbox.module.css";

const PAGE_SIZE = 50;
const MESSAGE_LIMIT = 100;

type SearchParams = Promise<{
  conversation?: string;
  page?: string;
  view?: string;
  q?: string;
}>;
type Conversation = {
  id: string;
  channel: string;
  contact_id: string | null;
  last_message_at: string | null;
  unread_count: number;
};
type Preview = { conversation_id: string; body: string | null; sent_at: string };
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
  if (!value) return "—";
  const date = new Date(value);
  const now = new Date();
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)} мин`;
  if (date.toDateString() === now.toDateString())
    return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(date);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "вчера";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(date);
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

async function loadInbox(
  selectedId: string | undefined,
  page: number,
  view: string,
  query: string,
) {
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
  let conversations = (conversationResult.data ?? []) as Conversation[];
  if (view === "unanswered")
    conversations = conversations.filter((item) => item.unread_count > 0);
  if (query)
    conversations = conversations.filter((item) =>
      `${item.channel} ${item.contact_id}`.toLowerCase().includes(query.toLowerCase()),
    );
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
  const previewResult = conversations.length
    ? await supabase
        .from("messages")
        .select("conversation_id, body, sent_at")
        .in("conversation_id", conversations.map((item) => item.id))
        .order("sent_at", { ascending: false })
    : { data: [], error: null };
  if (previewResult.error) errors.push(`Превью сообщений: ${previewResult.error.message}`);
  const previews = new Map<string, Preview>();
  for (const item of (previewResult.data ?? []) as Preview[]) {
    if (!previews.has(item.conversation_id)) previews.set(item.conversation_id, item);
  }
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
    previews,
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
  const view = params.view === "unanswered" ? "unanswered" : params.view === "mine" ? "mine" : "all";
  const query = params.q?.trim() ?? "";
  const data = await loadInbox(params.conversation, page, view, query);
  const selected = data.selected;
  const selectedContact = selected?.contact_id
    ? data.contactMap.get(selected.contact_id)
    : undefined;
  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const safePage = data.page;
  const queryString = (nextView: string) =>
    `/inbox?view=${nextView}${query ? `&q=${encodeURIComponent(query)}` : ""}`;
  const channels = [
    { name: "WhatsApp", status: "не подключён", connected: false },
    { name: "Instagram", status: "не подключён", connected: false },
    { name: "Facebook", status: "не подключён", connected: false },
    { name: "Viber", status: "не подключён", connected: false },
    { name: "Форма сайта", status: "работает", connected: true },
    { name: "Телефония", status: "работает", connected: true },
  ];

  return (
    <section className="inbox-page">
      <header className="inbox-header">
        <h1><Inbox size={16} /> Инбокс <span>{data.total}</span></h1>
        <span className="inbox-readonly">Звонки и заявки формы уже работают</span>
      </header>
      {data.errors.length > 0 && (
        <div className="inbox-alert" role="alert">
          Не всё удалось загрузить: {data.errors.join(" · ")}
        </div>
      )}
      <div className="inbox-toolbar">
        <nav className={styles.tabs} aria-label="Фильтр диалогов">
          <Link className={view === "all" ? styles.activeTab : ""} href={queryString("all")}>Все</Link>
          <Link className={view === "mine" ? styles.activeTab : ""} href={queryString("mine")}>Мои</Link>
          <Link className={view === "unanswered" ? styles.activeTab : ""} href={queryString("unanswered")}>Без ответа</Link>
        </nav>
        <form className={styles.search} method="get">
          <input type="hidden" name="view" value={view} />
          <Search size={14} />
          <input name="q" defaultValue={query} placeholder="Поиск по переписке" aria-label="Поиск по переписке" />
        </form>
      </div>
      <div className="inbox-grid">
        <aside className="inbox-list" aria-label="Диалоги">
          {data.conversations.length === 0 ? (
            <EmptyState
              icon={<MessageCircle size={18} />}
              title={data.total ? "По этому фильтру диалогов нет" : "Диалогов пока нет"}
              description={data.total ? "Попробуйте другой фильтр или поиск." : "Мессенджеры ещё не подключены. Здесь появится переписка, когда канал доставит её в CRM."}
            />
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
                    <span className={styles.preview}>
                      {data.previews.get(conversation.id)?.body ?? "Сообщений пока нет"}
                    </span>
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
            <>
              <EmptyState
                icon={<Phone size={18} />}
                title="Что уже работает"
                description="Звонки и заявки формы сайта приходят в CRM. Мессенджеры подключаются отдельно."
              />
              <div className={styles.channels}>
                {channels.map((channel) => (
                  <div className={styles.channel} key={channel.name}>
                    <span>{channel.name}</span>
                    <small className={channel.connected ? styles.connected : ""}>{channel.status}</small>
                  </div>
                ))}
              </div>
            </>
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
