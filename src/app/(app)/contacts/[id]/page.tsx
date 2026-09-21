import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  Clock3,
  Mail,
  MessageSquare,
  Phone,
  StickyNote,
  Tag,
} from "lucide-react";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import "../contacts.module.css";

const LIMIT = 50;

export default async function ContactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role === "builder") redirect("/reports");
  const { id } = await params;
  const db = await createClient();

  const contact = await db
    .from("contacts")
    .select("id, full_name, created_at")
    .eq("id", id)
    .is("merged_into", null)
    .maybeSingle();
  if (contact.error) throw new Error(`Контакт: ${contact.error.message}`);
  if (!contact.data) notFound();

  const [
    phoneRows,
    importedRows,
    emailRows,
    channelRows,
    tagLinks,
    directDeals,
    linkedDeals,
    directNotes,
    directCalls,
    conversations,
  ] = await Promise.all([
    db
      .from("contact_phones")
      .select("phone, is_primary")
      .eq("contact_id", id)
      .order("is_primary", { ascending: false })
      .limit(LIMIT),
    db
      .from("imported_contact_phones")
      .select("raw_phone, ordinal")
      .eq("contact_id", id)
      .order("ordinal")
      .limit(LIMIT),
    db
      .from("contact_emails")
      .select("email, ordinal")
      .eq("contact_id", id)
      .order("ordinal")
      .limit(LIMIT),
    db
      .from("contact_channels")
      .select("channel, handle")
      .eq("contact_id", id)
      .limit(LIMIT),
    db.from("contact_tags").select("tag_id").eq("contact_id", id).limit(LIMIT),
    db
      .from("deals")
      .select("id")
      .eq("contact_id", id)
      .order("created_at", { ascending: false })
      .range(0, LIMIT - 1),
    db
      .from("deal_contacts")
      .select("deal_id")
      .eq("contact_id", id)
      .order("deal_id")
      .range(0, LIMIT - 1),
    db
      .from("notes")
      .select("id, body, created_at, deal_id")
      .eq("contact_id", id)
      .or("amo_note_type.is.null,amo_note_type.not.in.(call_in,call_out)")
      .order("created_at", { ascending: false })
      .limit(LIMIT),
    db
      .from("calls")
      .select("id, direction, status, started_at, duration_sec, deal_id")
      .eq("contact_id", id)
      .order("started_at", { ascending: false })
      .limit(LIMIT),
    db
      .from("conversations")
      .select("id, channel")
      .eq("contact_id", id)
      .limit(LIMIT),
  ]);
  for (const result of [
    phoneRows,
    importedRows,
    emailRows,
    channelRows,
    tagLinks,
    directDeals,
    linkedDeals,
    directNotes,
    directCalls,
    conversations,
  ]) {
    if (result.error)
      throw new Error(`Данные контакта: ${result.error.message}`);
  }

  const dealIds = [
    ...new Set([
      ...(directDeals.data ?? []).map((row) => row.id),
      ...(linkedDeals.data ?? []).map((row) => row.deal_id),
    ]),
  ];
  const [dealRows, tags] = await Promise.all([
    dealIds.length
      ? db
          .from("deals")
          .select(
            "id, title, object_text, status, budget, budget_currency, stage_id, owner_id, created_at",
          )
          .in("id", dealIds.slice(0, LIMIT))
          .order("created_at", { ascending: false })
          .limit(LIMIT)
      : Promise.resolve({ data: [], error: null }),
    (tagLinks.data ?? []).length
      ? db
          .from("tags")
          .select("id, name")
          .in(
            "id",
            tagLinks.data!.map((row) => row.tag_id),
          )
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (dealRows.error)
    throw new Error(`Сделки контакта: ${dealRows.error.message}`);
  if (tags.error) throw new Error(`Теги контакта: ${tags.error.message}`);

  const visibleDealIds = (dealRows.data ?? []).map((row) => row.id);
  const [stages, owners, dealNotes, messages] = await Promise.all([
    [...new Set((dealRows.data ?? []).map((row) => row.stage_id))].length
      ? db
          .from("stages")
          .select("id, name")
          .in("id", [
            ...new Set((dealRows.data ?? []).map((row) => row.stage_id)),
          ])
      : Promise.resolve({ data: [], error: null }),
    [
      ...new Set(
        (dealRows.data ?? []).map((row) => row.owner_id).filter(Boolean),
      ),
    ].length
      ? db
          .from("profiles")
          .select("id, full_name")
          .in("id", [
            ...new Set(
              (dealRows.data ?? []).map((row) => row.owner_id).filter(Boolean),
            ),
          ])
      : Promise.resolve({ data: [], error: null }),
    visibleDealIds.length
      ? db
          .from("notes")
          .select("id, body, created_at, deal_id")
          .in("deal_id", visibleDealIds.slice(0, LIMIT))
          .or("amo_note_type.is.null,amo_note_type.not.in.(call_in,call_out)")
          .order("created_at", { ascending: false })
          .limit(LIMIT)
      : Promise.resolve({ data: [], error: null }),
    (conversations.data ?? []).length
      ? db
          .from("messages")
          .select("id, body, sent_at, direction, conversation_id")
          .in(
            "conversation_id",
            conversations.data!.map((row) => row.id),
          )
          .order("sent_at", { ascending: false })
          .limit(LIMIT)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [stages, owners, dealNotes, messages])
    if (result.error)
      throw new Error(`Лента контакта: ${result.error.message}`);

  const stageMap = new Map(
    (stages.data ?? []).map((row) => [row.id, row.name]),
  );
  const ownerMap = new Map(
    (owners.data ?? []).map((row) => [row.id, row.full_name]),
  );
  const feed: Array<{
    id: string;
    kind: "note" | "call" | "message";
    at: string;
    body?: string | null;
    direction?: string;
    duration?: number | null;
    status?: string | null;
  }> = [
    ...(directNotes.data ?? []).map((row) => ({
      id: row.id,
      kind: "note" as const,
      at: row.created_at,
      body: row.body,
    })),
    ...(dealNotes.data ?? []).map((row) => ({
      id: row.id,
      kind: "note" as const,
      at: row.created_at,
      body: row.body,
    })),
    ...(directCalls.data ?? []).map((row) => ({
      id: row.id,
      kind: "call" as const,
      at: row.started_at,
      direction: row.direction,
      duration: row.duration_sec,
      status: row.status,
    })),
    ...(messages.data ?? []).map((row) => ({
      id: row.id,
      kind: "message" as const,
      at: row.sent_at,
      body: row.body,
      direction: row.direction,
    })),
  ]
    .filter(
      (item, index, items) =>
        items.findIndex((candidate) => candidate.id === item.id) === index,
    )
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, LIMIT);
  const allPhones = [
    ...(phoneRows.data ?? []).map((row) => row.phone),
    ...(importedRows.data ?? []).map((row) => row.raw_phone),
  ].filter((value, index, values) => values.indexOf(value) === index);
  const shownDeals = dealRows.data?.length ?? 0;
  const shownFeed = feed.length;

  return (
    <section className="contact-record">
      <header className="record-header">
        <Link href="/contacts" className="record-back">
          <ArrowLeft size={16} /> Контакты
        </Link>
        <span className="record-separator">/</span>
        <strong>{contact.data.full_name}</strong>
      </header>
      <div className="contact-record-title">
        <span className="contact-avatar large">
          {contact.data.full_name.slice(0, 2).toUpperCase()}
        </span>
        <h1>{contact.data.full_name}</h1>
        <span className="quiet-chip">Контакт</span>
      </div>
      <div className="contact-layout">
        <aside className="contact-sidebar">
          <Info title="Контакт">
            <Field
              icon={<Phone size={14} />}
              label="Телефоны"
              value={allPhones.join(", ") || "Не заполнено"}
            />
            <Field
              icon={<Mail size={14} />}
              label="Почта"
              value={
                (emailRows.data ?? []).map((row) => row.email).join(", ") ||
                "Не заполнено"
              }
            />
            <Field
              icon={<MessageSquare size={14} />}
              label="Каналы"
              value={
                (channelRows.data ?? [])
                  .map((row) => row.handle || row.channel)
                  .join(", ") || "Не заполнено"
              }
            />
          </Info>
          <Info title="Теги">
            <div className="tag-list">
              {(tags.data ?? []).map((tag) => (
                <span className="tag" key={tag.id}>
                  <Tag size={12} />
                  {tag.name}
                </span>
              ))}
              {!tags.data?.length && <span className="muted">Нет тегов</span>}
            </div>
          </Info>
        </aside>
        <main className="contact-main">
          <Info title={`Связанные сделки · показано ${shownDeals}`}>
            <div className="deal-list">
              {(dealRows.data ?? []).map((deal) => (
                <Link
                  href={`/deals/${deal.id}`}
                  className="contact-deal"
                  key={deal.id}
                >
                  <span className="status-dot" />
                  <span>
                    <strong>
                      {deal.title || deal.object_text || "Сделка без названия"}
                    </strong>
                    <small>
                      {stageMap.get(deal.stage_id) ?? deal.status} ·{" "}
                      {ownerMap.get(deal.owner_id ?? "") ??
                        "Без ответственного"}
                    </small>
                  </span>
                  <b>
                    {deal.budget
                      ? `${deal.budget} ${deal.budget_currency ?? ""}`
                      : ""}
                  </b>
                </Link>
              ))}
              {!shownDeals && (
                <span className="muted">Связанных сделок нет</span>
              )}
            </div>
          </Info>
          <Info title={`Лента · Последние ${shownFeed} записей`}>
            <div className="activity-list">
              {feed.map((item) => (
                <div className="activity" key={item.id}>
                  {item.kind === "call" ? (
                    <Phone size={15} />
                  ) : item.kind === "message" ? (
                    <MessageSquare size={15} />
                  ) : (
                    <StickyNote size={15} />
                  )}
                  <span>
                    <strong>
                      {item.kind === "call"
                        ? item.direction === "in"
                          ? "Входящий звонок"
                          : "Исходящий звонок"
                        : item.kind === "message"
                          ? "Сообщение"
                          : "Примечание"}
                    </strong>
                    <small>
                      {item.kind === "call"
                        ? `${item.duration ? `${Math.round(item.duration / 60)} мин` : (item.status ?? "без ответа")}`
                        : (item.body ?? "")}
                    </small>
                  </span>
                </div>
              ))}
              {!feed.length && <span className="muted">Записей пока нет</span>}
            </div>
          </Info>
        </main>
      </div>
      <p className="bounded-note">
        <Clock3 size={14} /> История ограничена последними {LIMIT} записями.
      </p>
    </section>
  );
}

function Info({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="contact-info">
      <div className="contact-info-heading">
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}
function Field({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="contact-field">
      <span>
        {icon}
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}
