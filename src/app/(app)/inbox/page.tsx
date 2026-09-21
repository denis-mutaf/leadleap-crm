import Link from "next/link";
import { redirect } from "next/navigation";
import { Inbox, MessageCircle, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { EmptyState } from "@/components/crm/empty-state";
import type { Profile } from "@/lib/types";
import { Composer } from "./composer";
import { ThreadActions } from "./thread-actions";
import { ThreadOpen } from "./thread-open";
import { ChannelIcon, channelTitle } from "./channel-icon";
import styles from "./inbox.module.css";

const PAGE_SIZE = 50;
const MESSAGE_LIMIT = 100;
// Meta разрешает свободный ответ 24 часа после сообщения клиента.
const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
const SENDABLE = new Set(["facebook", "instagram"]);
const VIEWS = ["all", "unanswered", "mine"] as const;
type View = (typeof VIEWS)[number];

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
  display_name: string | null;
  last_message_at: string | null;
  last_direction: "in" | "out" | null;
  last_body: string | null;
  last_incoming_at: string | null;
  last_read_at: string | null;
  assigned_to: string | null;
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

function clock(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(
    new Date(value),
  );
}

function daySeparator(value: string) {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return "Сегодня";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Вчера";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  }).format(date);
}

// «Ждёт 3 ч» отвечает на единственный вопрос, который задаёт руководитель,
// глядя в инбокс: сколько мы уже молчим.
function waiting(value: string | null) {
  if (!value) return null;
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 60) return `ждёт ${Math.max(1, minutes)} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `ждёт ${hours} ч`;
  const days = Math.floor(hours / 24);
  return `ждёт ${days} дн`;
}

function title(conversation: Conversation, contact: Contact | undefined) {
  return contact?.full_name ?? conversation.display_name ?? "Без имени";
}

function unanswered(conversation: Conversation) {
  return conversation.last_direction === "in";
}

// Непрочитано — не то же, что без ответа: диалог могли открыть, прочитать и
// намеренно отложить. Жирным горит только по-настоящему непросмотренное.
function unread(conversation: Conversation) {
  if (conversation.last_direction !== "in") return false;
  if (!conversation.last_read_at) return true;
  if (!conversation.last_message_at) return false;
  return new Date(conversation.last_message_at) > new Date(conversation.last_read_at);
}

function replyBlock(conversation: Conversation): string | null {
  if (!SENDABLE.has(conversation.channel))
    return `Отвечать из CRM можно в Facebook и Instagram. Канал «${channelTitle(conversation.channel)}» так не работает: ответьте звонком или в самом канале.`;
  const last = conversation.last_incoming_at;
  if (!last || Date.now() - new Date(last).getTime() >= REPLY_WINDOW_MS)
    return "Клиент не писал больше 24 часов — Meta закрыла переписку для ответа. Позвоните ему или напишите первым из мессенджера.";
  return null;
}

// PostgREST разбирает ilike как часть фильтра, поэтому запятые, скобки и
// собственные подстановочные знаки из запроса убираются.
function safeQuery(value: string) {
  return value.replace(/[%_,()*]/g, " ").trim();
}

const COLUMNS =
  "id, channel, contact_id, display_name, last_message_at, last_direction, last_body, last_incoming_at, last_read_at, assigned_to";

async function loadInbox(
  profile: Profile,
  selectedId: string | undefined,
  page: number,
  view: View,
  query: string,
) {
  const supabase = await createClient();
  const errors: string[] = [];

  const [allCount, unansweredCount, mineCount] = await Promise.all([
    supabase.from("conversations").select("id", { count: "exact", head: true }),
    supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("last_direction", "in"),
    supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("assigned_to", profile.id),
  ]);
  for (const result of [allCount, unansweredCount, mineCount])
    if (result.error) errors.push(`Счётчики: ${result.error.message}`);
  const counts = {
    all: allCount.count ?? 0,
    unanswered: unansweredCount.count ?? 0,
    mine: mineCount.count ?? 0,
  };

  // Поиск идёт по тексту переписки, а не по служебным полям: менеджер ищет
  // «Ботаника» или номер, а не идентификатор контакта.
  let matched: string[] | null = null;
  const term = safeQuery(query);
  if (term) {
    const [byMessage, byName, byContact] = await Promise.all([
      supabase.from("messages").select("conversation_id").ilike("body", `%${term}%`).limit(1000),
      supabase.from("conversations").select("id").ilike("display_name", `%${term}%`).limit(200),
      supabase.from("contacts").select("id").ilike("full_name", `%${term}%`).limit(200),
    ]);
    for (const result of [byMessage, byName, byContact])
      if (result.error) errors.push(`Поиск: ${result.error.message}`);
    const ids = new Set<string>();
    for (const row of byMessage.data ?? []) ids.add(row.conversation_id as string);
    for (const row of byName.data ?? []) ids.add(row.id as string);
    const contactIds = (byContact.data ?? []).map((row) => row.id as string);
    if (contactIds.length) {
      const byContactConversations = await supabase
        .from("conversations")
        .select("id")
        .in("contact_id", contactIds)
        .limit(500);
      if (byContactConversations.error)
        errors.push(`Поиск по контактам: ${byContactConversations.error.message}`);
      for (const row of byContactConversations.data ?? []) ids.add(row.id as string);
    }
    matched = [...ids];
  }

  let listQuery = supabase
    .from("conversations")
    .select(COLUMNS, { count: "exact" })
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: true });
  if (view === "unanswered") listQuery = listQuery.eq("last_direction", "in");
  if (view === "mine") listQuery = listQuery.eq("assigned_to", profile.id);
  if (matched) listQuery = listQuery.in("id", matched.length ? matched : ["00000000-0000-0000-0000-000000000000"]);

  const probe = await listQuery.range(0, 0);
  if (probe.error) errors.push(`Диалоги: ${probe.error.message}`);
  const total = probe.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const offset = (safePage - 1) * PAGE_SIZE;

  let pageQuery = supabase
    .from("conversations")
    .select(COLUMNS)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: true });
  if (view === "unanswered") pageQuery = pageQuery.eq("last_direction", "in");
  if (view === "mine") pageQuery = pageQuery.eq("assigned_to", profile.id);
  if (matched) pageQuery = pageQuery.in("id", matched.length ? matched : ["00000000-0000-0000-0000-000000000000"]);
  const listResult = total ? await pageQuery.range(offset, offset + PAGE_SIZE - 1) : { data: [], error: null };
  if (listResult.error) errors.push(`Диалоги: ${listResult.error.message}`);
  const conversations = (listResult.data ?? []) as unknown as Conversation[];

  let selected = conversations.find((item) => item.id === selectedId);
  if (!selected && selectedId) {
    const selectedResult = await supabase
      .from("conversations")
      .select(COLUMNS)
      .eq("id", selectedId)
      .maybeSingle();
    if (selectedResult.error) errors.push(`Выбранный диалог: ${selectedResult.error.message}`);
    selected = (selectedResult.data as unknown as Conversation | null) ?? undefined;
  }
  if (!selectedId) selected = conversations[0];

  const messageResult = selected
    ? await supabase
        .from("messages")
        .select("id, direction, body, sent_at, author_user_id", { count: "exact" })
        .eq("conversation_id", selected.id)
        .order("sent_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(MESSAGE_LIMIT)
    : { data: [], count: 0, error: null };
  if (messageResult.error) errors.push(`Сообщения: ${messageResult.error.message}`);
  const messages = ((messageResult.data ?? []) as Message[]).slice().reverse();

  const visible = selected && !conversations.some((item) => item.id === selected.id)
    ? [...conversations, selected]
    : conversations;
  const contactIds = visible.map((item) => item.contact_id).filter((id): id is string => Boolean(id));
  const contactsResult = contactIds.length
    ? await supabase.from("contacts").select("id, full_name").in("id", contactIds)
    : { data: [], error: null };
  if (contactsResult.error) errors.push(`Контакты: ${contactsResult.error.message}`);
  const contactMap = new Map(((contactsResult.data ?? []) as Contact[]).map((item) => [item.id, item]));

  const staffIds = [
    ...new Set([
      ...visible.map((item) => item.assigned_to),
      ...messages.map((item) => item.author_user_id),
    ].filter((id): id is string => Boolean(id))),
  ];
  const staffResult = staffIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", staffIds)
    : { data: [], error: null };
  if (staffResult.error) errors.push(`Сотрудники: ${staffResult.error.message}`);
  const staffMap = new Map(
    ((staffResult.data ?? []) as { id: string; full_name: string }[]).map((item) => [item.id, item.full_name]),
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
        errors.push(`Импортированный телефон: ${importedPhoneResult.error.message}`);
      else
        phone =
          (importedPhoneResult.data as ImportedPhone | null)?.normalized_phone ??
          (importedPhoneResult.data as ImportedPhone | null)?.raw_phone ??
          null;
    }
    const linksResult = await supabase
      .from("deal_contacts")
      .select("deal_id")
      .eq("contact_id", selected.contact_id)
      .limit(50);
    if (linksResult.error) errors.push(`Связи сделок: ${linksResult.error.message}`);
    const directDealsResult = await supabase
      .from("deals")
      .select("id, title, object_text, status, stage_id, updated_at")
      .eq("contact_id", selected.contact_id)
      .limit(50);
    if (directDealsResult.error)
      errors.push(`Прямые сделки контакта: ${directDealsResult.error.message}`);
    const allDealIds = [
      ...new Set([
        ...(linksResult.data ?? []).map((row) => row.deal_id).filter(Boolean),
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
      if (dealsResult.error) errors.push(`Сделки контакта: ${dealsResult.error.message}`);
      else deal = (dealsResult.data?.[0] as Deal | undefined) ?? null;
    }
  }

  return {
    conversations,
    counts,
    total,
    selected,
    contactMap,
    staffMap,
    phone,
    deal,
    messages,
    messageTotal: messageResult.count ?? 0,
    errors,
    page: safePage,
    pages: totalPages,
  };
}

export default async function InboxPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role === "builder") redirect("/reports");
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const view = (VIEWS as readonly string[]).includes(params.view ?? "")
    ? (params.view as View)
    : "all";
  const query = params.q?.trim() ?? "";
  const data = await loadInbox(profile, params.conversation, page, view, query);
  const selected = data.selected;
  const selectedContact = selected?.contact_id ? data.contactMap.get(selected.contact_id) : undefined;
  const link = (next: Partial<{ view: string; page: number; conversation: string }>) => {
    const search = new URLSearchParams();
    const nextView = next.view ?? view;
    if (nextView !== "all") search.set("view", nextView);
    if (query) search.set("q", query);
    const nextPage = next.page ?? data.page;
    if (nextPage > 1) search.set("page", String(nextPage));
    if (next.conversation) search.set("conversation", next.conversation);
    const text = search.toString();
    return text ? `/inbox?${text}` : "/inbox";
  };
  const tabs: { key: View; label: string; count: number }[] = [
    { key: "all", label: "Все", count: data.counts.all },
    { key: "unanswered", label: "Без ответа", count: data.counts.unanswered },
    { key: "mine", label: "Мои", count: data.counts.mine },
  ];
  const channels = [
    { channel: "facebook", status: "работает", connected: true },
    { channel: "instagram", status: "работает", connected: true },
    { channel: "whatsapp", status: "ждёт проверки бизнеса", connected: false },
    { channel: "web_form", status: "работает", connected: true },
    { channel: "call", status: "работает", connected: true },
    { channel: "viber", status: "не подключён", connected: false },
  ];
  const blocked = selected ? replyBlock(selected) : null;

  return (
    <section className="inbox-page">
      <header className="inbox-header">
        <h1>
          <Inbox size={16} /> Инбокс <span>{data.counts.all}</span>
        </h1>
        {data.counts.unanswered > 0 && (
          <span className="inbox-waiting-total">
            Без ответа: {data.counts.unanswered}
          </span>
        )}
      </header>
      {data.errors.length > 0 && (
        <div className="inbox-alert" role="alert">
          Не всё удалось загрузить: {data.errors.join(" · ")}
        </div>
      )}
      <div className="inbox-toolbar">
        <nav className={styles.tabs} aria-label="Фильтр диалогов">
          {tabs.map((tab) => (
            <Link
              className={view === tab.key ? styles.activeTab : ""}
              href={link({ view: tab.key, page: 1 })}
              key={tab.key}
            >
              {tab.label}
              {tab.count > 0 && (
                <em className={tab.key === "unanswered" ? styles.countHot : styles.count}>
                  {tab.count}
                </em>
              )}
            </Link>
          ))}
        </nav>
        <form className={styles.search} method="get">
          {view !== "all" && <input type="hidden" name="view" value={view} />}
          <Search size={14} />
          <input
            name="q"
            defaultValue={query}
            placeholder="Поиск по переписке"
            aria-label="Поиск по переписке"
          />
        </form>
      </div>
      <div className="inbox-grid">
        <aside className="inbox-list" aria-label="Диалоги">
          {data.conversations.length === 0 ? (
            <EmptyState
              icon={<MessageCircle size={18} />}
              title={
                query
                  ? "Ничего не нашлось"
                  : data.counts.all
                    ? "По этому фильтру диалогов нет"
                    : "Диалогов пока нет"
              }
              description={
                query
                  ? "Попробуйте другое слово или снимите фильтр."
                  : data.counts.all
                    ? "Здесь пусто — значит, всем ответили."
                    : "Здесь появится переписка из мессенджеров."
              }
            />
          ) : (
            data.conversations.map((conversation) => {
              const contact = conversation.contact_id
                ? data.contactMap.get(conversation.contact_id)
                : undefined;
              const name = title(conversation, contact);
              const wait = unanswered(conversation) ? waiting(conversation.last_incoming_at) : null;
              return (
                <Link
                  className={`inbox-row ${selected?.id === conversation.id ? "selected" : ""} ${
                    unanswered(conversation) ? "waiting" : ""
                  } ${unread(conversation) ? "unread" : ""}`}
                  href={link({ conversation: conversation.id })}
                  key={conversation.id}
                >
                  <span className="inbox-avatar-wrap">
                    <span className="inbox-avatar">{name.slice(0, 2).toUpperCase()}</span>
                    <span className="inbox-channel-badge">
                      <ChannelIcon channel={conversation.channel} size={11} />
                    </span>
                  </span>
                  <span className="inbox-row-main">
                    <span className="inbox-row-top">
                      <strong>{name}</strong>
                      <small>{time(conversation.last_message_at)}</small>
                    </span>
                    {conversation.assigned_to && (
                      <small>{data.staffMap.get(conversation.assigned_to) ?? "сотрудник"}</small>
                    )}
                    <span className={styles.preview}>
                      {conversation.last_direction === "out" ? "Вы: " : ""}
                      {conversation.last_body?.trim() || "Вложение без текста"}
                    </span>
                  </span>
                  {wait && <span className="inbox-wait">{wait}</span>}
                </Link>
              );
            })
          )}
          {data.pages > 1 && (
            <nav className="inbox-pagination" aria-label="Страницы">
              <span>
                {`${(data.page - 1) * PAGE_SIZE + 1}–${Math.min(data.page * PAGE_SIZE, data.total)}`} из{" "}
                {data.total}
              </span>
              {data.page > 1 && <Link href={link({ page: data.page - 1 })}>Назад</Link>}
              {data.page < data.pages && <Link href={link({ page: data.page + 1 })}>Далее</Link>}
            </nav>
          )}
        </aside>
        <main className="inbox-thread">
          {!selected ? (
            <div className="inbox-thread-empty">
              {/* Звать выбрать из пустого списка нечестно: слева выбирать нечего. */}
              <span className="inbox-empty-mark">↗</span>
              <h2>{data.counts.all === 0 ? "Переписки ещё нет" : "Выберите диалог"}</h2>
              <p>
                {data.counts.all === 0
                  ? "Первое сообщение из подключённого канала откроется здесь."
                  : "Переписка появится здесь после выбора обращения из списка."}
              </p>
            </div>
          ) : (
            <>
              <header className="inbox-thread-header">
                <span className="inbox-avatar-wrap">
                  <span className="inbox-avatar">
                    {title(selected, selectedContact).slice(0, 2).toUpperCase()}
                  </span>
                  <span className="inbox-channel-badge">
                    <ChannelIcon channel={selected.channel} size={11} />
                  </span>
                </span>
                <div>
                  <h2>{title(selected, selectedContact)}</h2>
                  <p>
                    {channelTitle(selected.channel)}
                    {data.phone ? ` · ${data.phone}` : ""}
                    {selected.assigned_to
                      ? ` · ${data.staffMap.get(selected.assigned_to) ?? "сотрудник"}`
                      : ""}
                  </p>
                </div>
                <ThreadActions
                  conversationId={selected.id}
                  unread={unread(selected)}
                  mine={selected.assigned_to === profile.id}
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
                                ? ` · ${data.staffMap.get(message.author_user_id) ?? "сотрудник"}`
                                : ""}
                            </small>
                          </article>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
              <ThreadOpen conversationId={selected.id} unread={unread(selected)} />
              <Composer conversationId={selected.id} disabledReason={blocked} />
            </>
          )}
        </main>
        <aside className="inbox-context">
          <h2>Контекст</h2>
          {!selected ? (
            <div className={styles.channels}>
              {channels.map((channel) => (
                <div className={styles.channel} key={channel.channel}>
                  <span>
                    <ChannelIcon channel={channel.channel} size={13} />
                    {channel.channel === "call" ? "Телефония" : channelTitle(channel.channel)}
                  </span>
                  <small className={channel.connected ? styles.connected : ""}>{channel.status}</small>
                </div>
              ))}
            </div>
          ) : (
            <>
              {selectedContact ? (
                <>
                  <strong>{selectedContact.full_name}</strong>
                  {data.phone && <p>{data.phone}</p>}
                </>
              ) : (
                <div className="inbox-warning">
                  <strong>{selected.display_name ?? "Собеседник из мессенджера"}</strong>
                  <p>Карточки контакта ещё нет: переписка пришла из {channelTitle(selected.channel)}.</p>
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
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
