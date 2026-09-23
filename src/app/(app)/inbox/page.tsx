import Link from "next/link";
import Form from "next/form";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Inbox, MessageCircle, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { dbErrorText } from "@/lib/db-errors";
import { getCurrentProfile } from "@/lib/auth";
import { EmptyState } from "@/components/crm/empty-state";
import type { Profile } from "@/lib/types";
import { ChannelIcon, channelTitle } from "./channel-icon";
import { RowPending } from "./row-pending";
import { ThreadPanels } from "./thread";
import { ThreadSkeleton } from "./thread-skeleton";
import {
  type ConversationRow,
  COLUMNS_JOINED,
  PAGE_SIZE,
  type View,
  VIEWS,
  safeQuery,
  time,
  title,
  unanswered,
  unread,
  waiting,
} from "./shared";
import styles from "./inbox.module.css";

type SearchParams = Promise<{
  conversation?: string;
  page?: string;
  view?: string;
  q?: string;
}>;

async function loadList(
  profile: Profile,
  selectedId: string | undefined,
  page: number,
  view: View,
  query: string,
) {
  const supabase = await createClient();
  const errors: string[] = [];

  const counting = Promise.all([
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
      if (result.error) errors.push(`Поиск: ${dbErrorText(result.error)}`);
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
        errors.push(`Поиск по контактам: ${dbErrorText(byContactConversations.error)}`);
      for (const row of byContactConversations.data ?? []) ids.add(row.id as string);
    }
    matched = [...ids];
  }

  const listQuery = (from: number) => {
    let builder = supabase
      .from("conversations")
      .select(COLUMNS_JOINED, { count: "exact" })
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true });
    if (view === "unanswered") builder = builder.eq("last_direction", "in");
    if (view === "mine") builder = builder.eq("assigned_to", profile.id);
    if (matched)
      builder = builder.in("id", matched.length ? matched : ["00000000-0000-0000-0000-000000000000"]);
    return builder.range(from, from + PAGE_SIZE - 1);
  };

  // Один запрос вместо двух: количество приезжает вместе со строками, а не
  // отдельным кругом «сколько всего».
  let listResult = await listQuery((page - 1) * PAGE_SIZE);
  let total = listResult.count ?? 0;
  let safePage = page;
  if (page > 1 && (listResult.data ?? []).length === 0 && total > 0) {
    safePage = Math.max(1, Math.ceil(total / PAGE_SIZE));
    listResult = await listQuery((safePage - 1) * PAGE_SIZE);
    total = listResult.count ?? total;
  }
  if (listResult.error) errors.push(`Диалоги: ${dbErrorText(listResult.error)}`);
  const conversations = (listResult.data ?? []) as unknown as ConversationRow[];

  let selected = conversations.find((item) => item.id === selectedId);
  if (!selected && selectedId) {
    // Однократный повтор: при возврате «Назад» со сделки панель иногда
    // оставалась закрытой при живом ?conversation= — добор диалога по id
    // с первого раза не приезжал, повторный заход (F5) его находил.
    const loadSelected = () =>
      supabase
        .from("conversations")
        .select(COLUMNS_JOINED)
        .eq("id", selectedId)
        .maybeSingle();
    let selectedResult = await loadSelected();
    if (selectedResult.error) selectedResult = await loadSelected();
    if (selectedResult.error) errors.push("Выбранный диалог временно недоступен");
    selected = (selectedResult.data as unknown as ConversationRow | null) ?? undefined;
  }
  if (!selectedId) selected = conversations[0];

  const [allCount, unansweredCount, mineCount] = await counting;
  for (const result of [allCount, unansweredCount, mineCount])
    if (result.error) errors.push(`Счётчики: ${dbErrorText(result.error)}`);

  return {
    conversations,
    counts: {
      all: allCount.count ?? 0,
      unanswered: unansweredCount.count ?? 0,
      mine: mineCount.count ?? 0,
    },
    total,
    selected,
    errors,
    page: safePage,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
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
  const data = await loadList(profile, params.conversation, page, view, query);
  const selected = data.selected;
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

  return (
    <section className="inbox-page">
      <header className="inbox-header">
        <h1>
          <Inbox size={16} /> Инбокс <span>{data.counts.all}</span>
        </h1>
        {data.counts.unanswered > 0 && (
          <span className="inbox-waiting-total">Без ответа: {data.counts.unanswered}</span>
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
        <Form className={styles.search} action="/inbox" key={`${view}|${query}`}>
          {view !== "all" && <input type="hidden" name="view" value={view} />}
          <Search size={14} />
          <input
            name="q"
            defaultValue={query}
            placeholder="Поиск по переписке"
            aria-label="Поиск по переписке"
          />
        </Form>
      </div>
      <div className="inbox-grid">
        <aside className="inbox-list motion-list" aria-label="Диалоги">
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
            data.conversations.map((conversation, index) => {
              const name = title(conversation, conversation.contact ?? undefined);
              const wait = unanswered(conversation) ? waiting(conversation.last_incoming_at) : null;
              return (
                <Link
                  className={`inbox-row ${selected?.id === conversation.id ? "selected" : ""} ${
                    unanswered(conversation) ? "waiting" : ""
                  } ${unread(conversation) ? "unread" : ""}`}
                  href={link({ conversation: conversation.id })}
                  key={conversation.id}
                  style={{ "--i": index } as import("react").CSSProperties}
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
                      <small>{conversation.assignee?.full_name ?? "сотрудник"}</small>
                    )}
                    <span className={styles.preview}>
                      {conversation.last_direction === "out" ? "Вы: " : ""}
                      {conversation.last_body?.trim() || "Вложение без текста"}
                    </span>
                  </span>
                  {wait && <span className="inbox-wait">{wait}</span>}
                  <RowPending />
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
        {!selected ? (
          <>
            <main className="inbox-thread">
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
            </main>
            <aside className="inbox-context">
              <h2>Контекст</h2>
              <div className={styles.channels}>
                {channels.map((channel) => (
                  <div className={styles.channel} key={channel.channel}>
                    <span>
                      <ChannelIcon channel={channel.channel} size={13} />
                      {channel.channel === "call" ? "Телефония" : channelTitle(channel.channel)}
                    </span>
                    <small className={channel.connected ? styles.connected : ""}>
                      {channel.status}
                    </small>
                  </div>
                ))}
              </div>
            </aside>
          </>
        ) : (
          // Ключ по диалогу: при переключении React сразу показывает заглушку
          // нужной формы, а не держит на экране чужую переписку.
          <Suspense key={selected.id} fallback={<ThreadSkeleton />}>
            <ThreadPanels
              conversation={selected}
              contact={selected.contact ?? undefined}
              assignee={selected.assigned_to ? (selected.assignee?.full_name ?? "сотрудник") : null}
              profileId={profile.id}
            />
          </Suspense>
        )}
      </div>
    </section>
  );
}
