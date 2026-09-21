import Link from "next/link";
import { redirect } from "next/navigation";
import { Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import "./contacts.module.css";

const PAGE_SIZE = 50;

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  if (profile.role === "builder") redirect("/reports");

  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0, 80);
  const requestedPage = Math.max(
    0,
    Number.parseInt(params.page ?? "0", 10) || 0,
  );
  const supabase = await createClient();

  let countQuery = supabase
    .from("contacts")
    .select("id", { count: "exact", head: true })
    .is("merged_into", null);
  if (q) countQuery = countQuery.ilike("full_name", `%${escapeLike(q)}%`);
  const { count, error: countError } = await countQuery;
  if (countError)
    throw new Error(`Количество контактов: ${countError.message}`);

  const total = count ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const page = Math.min(requestedPage, lastPage);
  let rowsQuery = supabase
    .from("contacts")
    .select("id, full_name, created_at")
    .is("merged_into", null)
    .order("full_name")
    .order("id")
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  if (q) rowsQuery = rowsQuery.ilike("full_name", `%${escapeLike(q)}%`);
  const { data: contacts, error: contactsError } = await rowsQuery;
  if (contactsError) throw new Error(`Контакты: ${contactsError.message}`);

  const ids = (contacts ?? []).map((contact) => contact.id);
  const phoneMap = new Map<string, string>();
  if (ids.length) {
    const phones = await supabase
      .from("contact_phones")
      .select("contact_id, phone, is_primary")
      .in("contact_id", ids)
      .order("is_primary", { ascending: false });
    if (phones.error)
      throw new Error(`Телефоны контактов: ${phones.error.message}`);
    for (const phone of phones.data ?? []) {
      if (!phoneMap.has(phone.contact_id))
        phoneMap.set(phone.contact_id, phone.phone);
    }
    const missingIds = ids.filter((id) => !phoneMap.has(id));
    if (missingIds.length) {
      const imported = await supabase
        .from("imported_contact_phones")
        .select("contact_id, raw_phone, ordinal")
        .in("contact_id", missingIds)
        .order("ordinal");
      if (imported.error)
        throw new Error(`Импортированные телефоны: ${imported.error.message}`);
      for (const phone of imported.data ?? []) {
        if (!phoneMap.has(phone.contact_id))
          phoneMap.set(phone.contact_id, phone.raw_phone);
      }
    }
  }

  const pageHref = (nextPage: number) =>
    `/contacts?${new URLSearchParams({ ...(q ? { q } : {}), page: String(nextPage) })}`;

  return (
    <section className="contacts-page">
      <header className="contacts-toolbar">
        <div>
          <p className="eyebrow">Клиенты</p>
          <h1>
            Контакты <span className="count-badge">{total}</span>
          </h1>
        </div>
        <form className="contacts-search" role="search">
          <Search size={15} />
          <input
            name="q"
            defaultValue={q}
            placeholder="Поиск по имени"
            aria-label="Поиск по имени"
          />
          <button type="submit">Найти</button>
        </form>
      </header>
      <div className="contacts-table" role="table">
        <div className="contacts-row contacts-head" role="row">
          <span>Имя</span>
          <span>Телефон</span>
          <span>Добавлен</span>
          <span />
        </div>
        {(contacts ?? []).map((contact) => (
          <Link
            className="contacts-row"
            role="row"
            key={contact.id}
            href={`/contacts/${contact.id}`}
          >
            <span className="contact-name">
              <span className="contact-avatar">
                {contact.full_name.slice(0, 2).toUpperCase()}
              </span>
              {contact.full_name}
            </span>
            <span>{phoneMap.get(contact.id) ?? "—"}</span>
            <span>
              {new Date(contact.created_at).toLocaleDateString("ru-RU", {
                day: "numeric",
                month: "short",
              })}
            </span>
            <span className="row-arrow">→</span>
          </Link>
        ))}
        {!contacts?.length && (
          <div className="contacts-empty">Контакты не найдены</div>
        )}
      </div>
      <nav className="contacts-pagination" aria-label="Страницы контактов">
        <span>
          {total
            ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} из ${total}`
            : "0 контактов"}
        </span>
        <span>
          <Link
            className={page === 0 ? "disabled" : ""}
            href={page ? pageHref(page - 1) : pageHref(0)}
          >
            Назад
          </Link>
          <Link
            className={page >= lastPage ? "disabled" : ""}
            href={page < lastPage ? pageHref(page + 1) : pageHref(page)}
          >
            Дальше
          </Link>
        </span>
      </nav>
    </section>
  );
}

function escapeLike(value: string) {
  return value.replace(/[\\%_,]/g, " ");
}
