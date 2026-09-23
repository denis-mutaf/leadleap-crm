import type { CSSProperties } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  Mail,
  MessageCircle,
  Phone,
  StickyNote,
  Tag,
} from "lucide-react";
import { EmptyLine, EmptyState } from "@/components/crm/empty-state";
import { InlineField, ReadField } from "@/components/crm/inline-field";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import ContactDeleteButton from "../contact-delete-button";
import ContactMergeButton from "../contact-merge-button";
import { ContactEmails, ContactPhones, ContactTags, EditableCustomField } from "../contact-editors";
import styles from "../contacts.module.css";
import { countWord } from "@/lib/plural";

const LIMIT = 50;
type AmoField = {
  field_id?: number | string;
  field_name?: string;
  field_code?: string;
  values?: Array<{ value?: unknown; enum?: string; enum_code?: string }>;
};

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

  const contactResult = await db
    .from("contacts")
    .select("id, full_name, created_at, amo_custom_fields")
    .eq("id", id)
    .is("merged_into", null)
    .maybeSingle();
  if (contactResult.error) throw new Error(`Контакт: ${contactResult.error.message}`);
  if (!contactResult.data) notFound();
  const [customDefsResult, customValuesResult] = await Promise.all([
    db.from("custom_field_defs").select("id, key, label, field_type, options").eq("entity", "contact").eq("is_active", true).order("position"),
    db.from("custom_field_values").select("id, field_id, value").eq("entity_id", id),
  ]);
  if (customDefsResult.error || customValuesResult.error) throw new Error(`Поля контакта: ${(customDefsResult.error ?? customValuesResult.error)?.message}`);

  const [phoneRows, importedRows, emailRows, channelRows, tagLinks, directDeals, linkedDeals, conversations] = await Promise.all([
    db.from("contact_phones").select("id, phone, is_primary").eq("contact_id", id).order("is_primary", { ascending: false }).order("created_at").limit(LIMIT),
    db.from("imported_contact_phones").select("raw_phone, ordinal, label").eq("contact_id", id).order("ordinal").limit(LIMIT),
    db.from("contact_emails").select("email, ordinal, label").eq("contact_id", id).order("ordinal").limit(LIMIT),
    db.from("contact_channels").select("channel, handle").eq("contact_id", id).limit(LIMIT),
    db.from("contact_tags").select("tag_id").eq("contact_id", id).limit(LIMIT),
    db.from("deals").select("id").eq("contact_id", id).order("created_at", { ascending: false }).limit(LIMIT),
    db.from("deal_contacts").select("deal_id").eq("contact_id", id).limit(LIMIT),
    db.from("conversations").select("id, channel").eq("contact_id", id).limit(LIMIT),
  ]);
  for (const result of [phoneRows, importedRows, emailRows, channelRows, tagLinks, directDeals, linkedDeals, conversations]) {
    if (result.error) throw new Error(`Данные контакта: ${result.error.message}`);
  }

  const dealIds = [...new Set([
    ...(directDeals.data ?? []).map((row) => row.id),
    ...(linkedDeals.data ?? []).map((row) => row.deal_id),
  ])].slice(0, LIMIT);
  const tagIds = (tagLinks.data ?? []).map((row) => row.tag_id);
  // Менеджер пишет заметку на сделке, а не на контакте: в Amo она всё равно
  // видна в карточке клиента. Лента собирает и то, что привязано к контакту
  // напрямую, и то, что записано на любой из его сделок.
  const ownFilter = `contact_id.eq.${id}`;
  const feedFilter = dealIds.length
    ? `${ownFilter},deal_id.in.(${dealIds.join(",")})`
    : ownFilter;
  const [notes, calls] = await Promise.all([
    db.from("notes").select("id, body, created_at, deal_id").or(feedFilter).is("deleted_at", null).or("amo_note_type.is.null,amo_note_type.not.in.(call_in,call_out)").order("created_at", { ascending: false }).limit(LIMIT),
    db.from("calls").select("id, direction, status, started_at, duration_sec, deal_id").or(feedFilter).order("started_at", { ascending: false }).limit(LIMIT),
  ]);
  if (notes.error || calls.error) throw new Error(`Лента контакта: ${(notes.error ?? calls.error)?.message}`);
  const [dealRows, tags, allTags] = await Promise.all([
    dealIds.length ? db.from("deals").select("id, title, object_text, status, budget, budget_currency, stage_id, owner_id, created_at").in("id", dealIds).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
    tagIds.length ? db.from("tags").select("id, name").in("id", tagIds) : Promise.resolve({ data: [], error: null }),
    db.from("tags").select("id, name").order("name").limit(100),
  ]);
  if (dealRows.error || tags.error || allTags.error) throw new Error(`Связанные данные: ${(dealRows.error ?? tags.error ?? allTags.error)?.message}`);

  const stageIds = [...new Set((dealRows.data ?? []).map((deal) => deal.stage_id))];
  const ownerIds = [...new Set((dealRows.data ?? []).map((deal) => deal.owner_id).filter(Boolean))];
  const [stages, owners] = await Promise.all([
    stageIds.length ? db.from("stages").select("id, name").in("id", stageIds) : Promise.resolve({ data: [], error: null }),
    ownerIds.length ? db.from("profiles").select("id, full_name").in("id", ownerIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (stages.error || owners.error) throw new Error(`Справочники контакта: ${(stages.error ?? owners.error)?.message}`);

  const fields = Array.isArray(contactResult.data.amo_custom_fields) ? contactResult.data.amo_custom_fields as AmoField[] : [];
  const customDefinitions = (customDefsResult.data ?? []) as Array<{ id: string; key: string; label: string; field_type: "text" | "number" | "date" | "select" | "checkbox"; options: unknown }>;
  const customValues = new Map((customValuesResult.data ?? []).map((row) => [row.field_id, row]));
  const phones = phoneRows.data ?? [];
  // Amo отдаёт тот же номер ещё раз своим форматом («+373 6079-1676»).
  // Показывать его второй строкой незачем — сравниваем по цифрам.
  const digits = (value: string) => value.replace(/\D/g, "");
  const knownDigits = new Set((phoneRows.data ?? []).map((row) => digits(row.phone)));
  const importedPhones = (importedRows.data ?? []).filter(
    (row) => !knownDigits.has(digits(row.raw_phone)),
  );
  const emails = emailRows.data ?? [];
  const customSource = findField(fields, /source|источник|канал/i);
  const normalizedSource = customDefinitions.find((definition) => /source|источник|канал/i.test(`${definition.key} ${definition.label}`));
  const firstSource = normalizedSource ? customValueText(customValues.get(normalizedSource.id)?.value) : fieldValue(customSource);
  const stageMap = new Map((stages.data ?? []).map((row) => [row.id, row.name]));
  const ownerMap = new Map((owners.data ?? []).map((row) => [row.id, row.full_name]));
  const statusLabels: Record<string, string> = { open: "В работе", postponed: "Отложена", won: "Выиграна", lost: "Проиграна" };
  const feed = [
    ...(notes.data ?? []).map((item) => ({ id: `note-${item.id}`, at: item.created_at, kind: "note" as const, body: item.body, dealId: item.deal_id })),
    ...(calls.data ?? []).map((item) => ({ id: `call-${item.id}`, at: item.started_at, kind: "call" as const, body: item.status, dealId: item.deal_id, direction: item.direction, duration: item.duration_sec })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, LIMIT);
  const groupedFeed = groupByDay(feed);
  const displayName = decodeHtmlEntities(contactResult.data.full_name);
  const allPhones = [...new Set([...phones.map((row) => row.phone), ...importedPhones.map((row) => row.raw_phone)])];

  return (
    <section className={styles.contactRecord}>
      <header className={styles.recordHeader}>
        <Link href="/contacts" className={styles.recordBack}><ArrowLeft size={15} /> Контакты</Link>
        <span className={styles.recordSeparator}>/</span>
        <span className={styles.truncate}>{displayName}</span>
        <span className={styles.headerSpacer} />
        <Link href="/contacts" className={styles.iconButton} aria-label="Закрыть карточку">×</Link>
      </header>
      <div className={styles.recordToolbar}>
        <span className={`${styles.contactAvatar} ${styles.avatarLarge}`}>{initials(displayName)}</span>
        <strong>{displayName}</strong>
        <span className={styles.recordType}>Контакт</span>
        <span className={styles.headerSpacer} />
        {phones[0] && <a className={styles.toolbarButton} href={`tel:${phones[0].phone}`}><Phone size={14} /> Позвонить</a>}
        {emails[0] && <a className={styles.toolbarButton} href={`mailto:${emails[0].email}`}><Mail size={14} /> Написать</a>}
        <ContactMergeButton current={{ id: contactResult.data.id, fullName: displayName, phones: allPhones, emails: emails.map((row) => row.email), dealCount: dealIds.length, createdAt: contactResult.data.created_at, source: firstSource }} />
        <ContactDeleteButton contactId={contactResult.data.id} />
      </div>
      <div className={styles.recordBody}>
        <aside className={styles.recordLeft}>
          <section>
            <p className={styles.groupHead}>Контакт</p>
            <InlineField label="Имя" table="contacts" id={id} column="full_name" value={contactResult.data.full_name} />
            <div className={styles.collectionField}><span>Телефоны</span><ContactPhones contactId={id} phones={phones} /></div>
            {importedPhones.map((phone) => <ReadField key={`${phone.ordinal}-${phone.raw_phone}`} label={phone.label || `Импортированный телефон ${phone.ordinal + 1}`} value={phone.raw_phone} />)}
            <div className={styles.collectionField}><span>Почта</span><ContactEmails contactId={id} emails={emails} /></div>
            <ReadField label="Каналы" value={channelRows.data?.length ? channelRows.data.map((row) => row.handle || row.channel).join(", ") : null} />
          </section>
          <section>
            <p className={styles.groupHead}>Источник</p>
            <ReadField label="В базе с" value={formatDateTime(contactResult.data.created_at)} />
            <ReadField label="Источник первого обращения" value={firstSource} />
            <ReadField label="Первое обращение" value={fieldValue(findField(fields, /first|перв.*обращ/i))} />
          </section>
          <section>
            <p className={styles.groupHead}><Tag size={14} /> Метки</p>
            <ContactTags contactId={id} tags={(tags.data ?? []) as Array<{ id: string; name: string }>} allTags={(allTags.data ?? []) as Array<{ id: string; name: string }>} />
          </section>
          {/* Пустой раздел «Данные Amo» с единственной строкой «Поля Amo —»
              занимал место и ничего не сообщал: у контакта их просто нет. */}
          {customDefinitions.length > 0 && <section>
            <p className={styles.groupHead}>Данные Amo</p>
            {customDefinitions.map((definition) => <EditableCustomField key={definition.id} contactId={id} definition={definition} current={customValues.get(definition.id)} />)}
          </section>}
        </aside>
        <main className={styles.recordRight}>
          <div className={styles.dealsHeader}><span>Сделки</span><span className={styles.countBadge}>{dealRows.data?.length ?? 0}</span></div>
          <div className={`${styles.dealList} motion-list`}>
            {(dealRows.data ?? []).map((deal, index) => (
              <Link href={`/deals/${deal.id}`} className={styles.dealCard} key={deal.id} style={{ "--i": index } as CSSProperties}>
                <span className={`${styles.statusDot} ${styles[`status${deal.status}`] ?? ""}`} />
                <span className={styles.dealMain}><strong>{deal.title || deal.object_text || "Сделка без названия"}</strong><span>{statusLabels[deal.status] ?? deal.status} · {stageMap.get(deal.stage_id) ?? "Без этапа"}</span></span>
                <span className={styles.dealMeta}>{deal.owner_id ? ownerMap.get(deal.owner_id) : "Без ответственного"}</span>
                <span className={styles.dealMeta}>{formatDate(deal.created_at)}</span>
              </Link>
            ))}
            {!dealRows.data?.length && <EmptyState title="Сделок пока нет" description="Создайте сделку, чтобы вести переговоры и этапы клиента." action={<Link className={`${styles.primaryButton} btn btn-primary`} href="/deals">Новая сделка</Link>} />}
          </div>
          <div className={styles.feedHeader}><span>Лента</span><span className={styles.feedHint}>{feed.length ? countWord(feed.length, "запись", "записи", "записей") : "Примечания и звонки"}</span></div>
          <div className={`${styles.feed} motion-list`}>
            {groupedFeed.map(([day, items], index) => <div className={styles.feedGroup} key={day} style={{ "--i": index } as CSSProperties}><p className={styles.feedDate}>{day}</p>{items.map((item) => <div className={styles.feedRow} key={item.id}>{item.kind === "call" ? <Phone size={15} /> : <StickyNote size={15} />}<span>{item.kind === "call" ? `${item.direction === "in" ? "Входящий" : "Исходящий"} звонок${item.duration ? ` · ${Math.round(item.duration / 60)} мин` : ""}` : item.body || "Примечание без текста"}<small>{item.kind === "call" ? `${item.body || "без записи"} · ${formatTime(item.at)}` : formatTime(item.at)}</small></span></div>)}</div>)}
            {!feed.length && <EmptyLine>Записей пока нет — заметки и звонки этого контакта появятся здесь.</EmptyLine>}
          </div>
          {!conversations.data?.length && <div className={styles.channelNotice}><MessageCircle size={15} /> Переписка появится, когда подключим WhatsApp.</div>}
        </main>
      </div>
    </section>
  );
}

function initials(name: string): string { return decodeHtmlEntities(name).split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }
function formatDate(value: string): string { const date = new Date(value); return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Chisinau", day: "numeric", month: "short", ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) }).format(date); }
function formatDateTime(value: string): string { return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Chisinau", day: "numeric", month: "long", year: "numeric" }).format(new Date(value)); }
function formatTime(value: string): string { return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Chisinau", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function fieldValue(field: AmoField | undefined): string | null { if (!field) return null; return (field.values ?? []).map((item) => typeof item.value === "string" || typeof item.value === "number" ? String(item.value) : item.enum ?? item.enum_code ?? "").filter(Boolean).join(", ") || null; }
function customValueText(value: unknown): string | null { if (value === null || value === undefined || value === "") return null; if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value); if (Array.isArray(value)) return value.map(String).join(", "); return JSON.stringify(value); }
function decodeHtmlEntities(value: string): string { return value.replace(/&lt;|&gt;|&amp;|&quot;|&#39;/g, (entity) => ({ "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&#39;": "'" })[entity] ?? entity); }
function findField(fields: AmoField[], pattern: RegExp): AmoField | undefined { return fields.find((field) => pattern.test(`${field.field_name ?? ""} ${field.field_code ?? ""}`)); }
function groupByDay<T extends { at: string }>(items: T[]): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const item of items) { const key = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Chisinau", day: "numeric", month: "long", year: "numeric" }).format(new Date(item.at)); groups.set(key, [...(groups.get(key) ?? []), item]); }
  return [...groups.entries()];
}
