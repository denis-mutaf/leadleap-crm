import type { CSSProperties } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Search, Users } from "lucide-react";
import { EmptyState } from "@/components/crm/empty-state";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { ContactSortSelect } from "./contact-sort-select";
import styles from "./contacts.module.css";

const PAGE_SIZE = 50;
type Sort = "name" | "created" | "activity";
type ContactRow = {
  id: string;
  full_name: string;
  created_at: string;
  phone: string | null;
  deal_count: number | string;
  last_activity_at: string | null;
  total_count: number | string;
};

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; sort?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  if (profile.role === "builder") redirect("/reports");

  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0, 80);
  const rpcQuery = q ? (/[<>"']/.test(q) ? encodeHtmlEntities(q) : q) : null;
  const requestedPage = Math.max(0, Number.parseInt(params.page ?? "0", 10) || 0);
  const sort: Sort = params.sort === "name" || params.sort === "created" ? params.sort : "activity";
  const supabase = await createClient();

  const response = await supabase.rpc("list_contacts_page", {
    p_query: rpcQuery,
    p_sort: sort,
    p_page: requestedPage,
    p_page_size: PAGE_SIZE,
  });
  if (response.error) throw new Error(`Контакты: ${response.error.message}`);
  const firstRows = (response.data ?? []) as unknown as ContactRow[];
  const total = Number(firstRows[0]?.total_count ?? 0);
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const page = Math.min(requestedPage, lastPage);
  let rows = firstRows;
  if (page !== requestedPage) {
    const corrected = await supabase.rpc("list_contacts_page", {
      p_query: rpcQuery,
      p_sort: sort,
      p_page: page,
      p_page_size: PAGE_SIZE,
    });
    if (corrected.error) throw new Error(`Контакты: ${corrected.error.message}`);
    rows = (corrected.data ?? []) as unknown as ContactRow[];
  }

  const pageHref = (nextPage: number) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (sort !== "name") query.set("sort", sort);
    query.set("page", String(nextPage));
    return `/contacts?${query.toString()}`;
  };

  return (
    <section className={styles.contactsPage}>
      <header className={styles.pageHeader}>
        <div className={styles.breadcrumbs}>
          <span>Контакты</span>
          <span className={styles.muted}>Клиенты и история обращений</span>
        </div>
        <span className={styles.headerCount}>{total}</span>
      </header>
      <div className={styles.listToolbar}>
        <form className={styles.searchForm} role="search">
          <Search size={15} aria-hidden="true" />
          <input name="q" defaultValue={q} placeholder="Поиск по имени или телефону" aria-label="Поиск по имени или телефону" />
          <input type="hidden" name="sort" value={sort} />
          <button type="submit" className="btn btn-primary">Найти</button>
        </form>
        <ContactSortSelect value={sort} q={q} />
      </div>
      <div className={`${styles.contactsTable} motion-list`} role="table" aria-label="Контакты">
        <div className={`${styles.contactsRow} ${styles.contactsHead}`} role="row">
          <span>Имя</span>
          <span>Телефон</span>
          <span>Сделок</span>
          <span>Последняя активность</span>
          <span>Добавлен</span>
          <span />
        </div>
        {rows.map((contact, index) => (
          <Link className={styles.contactsRow} role="row" key={contact.id} href={`/contacts/${contact.id}`} style={{ "--i": index } as CSSProperties}>
            <span className={styles.contactName}>
              <span className={styles.contactAvatar}>{initials(contact.full_name)}</span>
              <span className={styles.truncate}>{contact.full_name}</span>
            </span>
            <span className={styles.secondaryCell}>{contact.phone ?? "—"}</span>
            <span className={styles.dealCount}>{Number(contact.deal_count) || 0}</span>
            <span className={styles.secondaryCell}>{formatDate(contact.last_activity_at, "Нет активности")}</span>
            <span className={styles.secondaryCell}>{formatDate(contact.created_at)}</span>
            <span className={styles.rowArrow} aria-hidden="true">→</span>
          </Link>
        ))}
        {!rows.length && (
          <EmptyState
            icon={<Users size={18} />}
            title={q ? "Ничего не найдено" : "Контактов пока нет"}
            description={q ? `По запросу «${q}» нет контактов. Попробуйте имя или номер телефона.` : "Импортированные клиенты появятся здесь."}
          />
        )}
      </div>
      <nav className={styles.pagination} aria-label="Страницы контактов">
        <span>{total ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} из ${total}` : "0 контактов"}</span>
        <span className={styles.paginationLinks}>
          <Link className={`btn-ghost ${page === 0 ? styles.disabled : ""}`} href={page ? pageHref(page - 1) : pageHref(0)}>Назад</Link>
          <Link className={`btn-ghost ${page >= lastPage ? styles.disabled : ""}`} href={page < lastPage ? pageHref(page + 1) : pageHref(page)}>Дальше</Link>
        </span>
      </nav>
    </section>
  );
}

function initials(name: string): string {
  return decodeHtmlEntities(name).split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function formatDate(value: string | null | undefined, empty = "—"): string {
  if (!value) return empty;
  const date = new Date(value);
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Chisinau", day: "numeric", month: "short", ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) }).format(date);
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&lt;|&gt;|&amp;|&quot;|&#39;/g, (entity) => ({ "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&#39;": "'" })[entity] ?? entity);
}

function encodeHtmlEntities(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
