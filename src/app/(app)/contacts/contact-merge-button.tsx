"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import styles from "./contacts.module.css";

type Candidate = {
  id: string;
  fullName: string;
  createdAt: string;
  phones: string[];
  emails: string[];
  dealCount: number;
  source: string | null;
};
type Props = { current: Candidate };
const esc = (v: string) => v.replace(/[\\%_]/g, "\\$&");

async function loadCandidate(id: string, fullName: string, createdAt: string, customFields: unknown): Promise<Candidate> {
  const db = createClient();
  const [phones, imported, emails, deals] = await Promise.all([
    db.from("contact_phones").select("phone").eq("contact_id", id).limit(100),
    db
      .from("imported_contact_phones")
      .select("raw_phone")
      .eq("contact_id", id)
      .limit(100),
    db.from("contact_emails").select("email").eq("contact_id", id).limit(100),
    db
      .from("deals")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", id),
  ]);
  const failed = [phones, imported, emails, deals].find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);
  return {
    id,
    fullName,
    createdAt,
    phones: [
      ...new Set([
        ...(phones.data ?? []).map((r) => r.phone),
        ...(imported.data ?? []).map((r) => r.raw_phone),
      ]),
    ],
    emails: [...new Set((emails.data ?? []).map((r) => r.email))],
    dealCount: deals.count ?? 0,
    source: findSource(customFields),
  };
}

export default function ContactMergeButton({ current }: Props) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const requestRef = useRef(0);
  const pendingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [other, setOther] = useState<Candidate | null>(null);
  const [survivorId, setSurvivorId] = useState(current.id);
  const [nameSource, setNameSource] = useState(current.id);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => {
    requestRef.current += 1;
    setResults([]);
    setLoading(false);
  };
  useEffect(() => {
    const term = query.trim();
    if (!open || other || term.length < 2) return;
    const id = ++requestRef.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        setLoading(true);
        try {
          const response = await createClient()
            .from("contacts")
              .select("id, full_name, created_at, amo_custom_fields")
            .ilike("full_name", `%${esc(term)}%`)
            .neq("id", current.id)
            .is("merged_into", null)
            .order("full_name")
            .limit(8);
          if (id !== requestRef.current) return;
          if (response.error) throw new Error(response.error.message);
          const rows = await Promise.all(
            (response.data ?? []).map((r) => loadCandidate(r.id, r.full_name, r.created_at, r.amo_custom_fields)),
          );
          if (id === requestRef.current) setResults(rows);
        } catch (e) {
          if (id === requestRef.current)
            setError(
              e instanceof Error ? e.message : "Не удалось найти контакт",
            );
        } finally {
          if (id === requestRef.current) setLoading(false);
        }
      })();
    }, 280);
    return () => window.clearTimeout(timer);
  }, [current.id, open, other, query]);

  const close = () => {
    if (pendingRef.current) return;
    invalidate();
    setOpen(false);
    setOther(null);
    setQuery("");
    setError(null);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  };
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!pendingRef.current) close();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const f = [
          ...dialogRef.current.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled)",
          ),
        ];
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) {
          e.preventDefault();
          f.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === f.at(-1)) {
          e.preventDefault();
          f[0].focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });
  const choose = (c: Candidate) => {
    invalidate();
    setOther(c);
    setQuery("");
    setError(null);
    const id = c.dealCount > current.dealCount ? c.id : current.id;
    setSurvivorId(id);
    setNameSource(id);
  };
  async function submit() {
    if (!other || pendingRef.current) return;
    pendingRef.current = true;
    setSubmitting(true);
    setError(null);
    const source = survivorId === current.id ? other.id : current.id;
    try {
      const r = await createClient().rpc("merge_crm_contacts", {
        p_source_contact: source,
        p_target_contact: survivorId,
        p_name_source: nameSource,
      });
      if (r.error) throw new Error(r.error.message);
      router.push(`/contacts/${survivorId}`);
      router.refresh();
    } catch (e) {
      pendingRef.current = false;
      setSubmitting(false);
      setError(
        e instanceof Error && e.message.includes("custom field")
          ? "Есть конфликт пользовательских полей. Выберите значение вручную перед слиянием."
          : e instanceof Error
            ? e.message
            : "Слияние не выполнено",
      );
    }
  }
  const source = other && (survivorId === current.id ? other : current);
  const survivor = survivorId === current.id ? current : other;
  return (
    <>
      <button
        ref={triggerRef}
        className={styles.mergeButton}
        type="button"
        onClick={() => {
          setOpen(true);
          setError(null);
        }}
      >
        Объединить
      </button>
      {open && (
        <div
          className={styles.mergeScrim}
          role="presentation"
          onMouseDown={(e) =>
            e.target === e.currentTarget && !pendingRef.current && close()
          }
        >
          <section
            ref={dialogRef}
            className={styles.mergeModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="merge-title"
          >
            <header className={styles.mergeHeader}>
              <h2 id="merge-title">Объединить контакты</h2>
              <button
                type="button"
                aria-label="Закрыть"
                onClick={close}
                disabled={submitting}
              >
                <X size={16} />
              </button>
            </header>
            {!other ? (
              <div className={styles.mergeSearchArea}>
                <p>
                  Найдите второй контакт по имени. Загружаются только
                  совпадения.
                </p>
                <label className={styles.mergeSearch}>
                  <Search size={15} />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      invalidate();
                      setError(null);
                    }}
                    placeholder="Имя контакта"
                  />
                  {loading && <Loader2 className={styles.spin} size={15} />}
                </label>
                {error && <p className={styles.mergeError}>{error}</p>}
                <div className={styles.mergeResults}>
                  {results.map((c) => (
                    <button type="button" key={c.id} onClick={() => choose(c)}>
                      <strong>{c.fullName}</strong>
                      <span>{c.dealCount} прямых сделок</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <p className={styles.mergeIntro}>Сделки, звонки и переписка обеих карточек сохранятся. Выберите, какие данные останутся в объединённом контакте.</p>
                <div className={styles.mergeColumns}>
                  {[current, other].map((c) => (
                    <label
                      className={`${styles.mergeCard} ${survivorId === c.id ? styles.selected : ""}`}
                      key={c.id}
                    >
                      <input
                        type="radio"
                        name="survivor"
                        checked={survivorId === c.id}
                        onChange={() => {
                          setSurvivorId(c.id);
                          setNameSource(c.id);
                        }}
                      />
                      <span className={styles.candidateHeader}>
                        <span className={styles.contactAvatar}>{initials(c.fullName)}</span>
                        <span><strong>{c.fullName}</strong><small>создан {formatDate(c.createdAt)} · {c.dealCount} {plural(c.dealCount, "сделка", "сделки", "сделок")}</small></span>
                        {survivorId === c.id && <span className={styles.primaryCandidate}>Основной</span>}
                      </span>
                    </label>
                  ))}
                </div>
                <div className={styles.mergeRows}>
                  <MergeRow label="Имя" left={current.fullName} right={other.fullName} selected={nameSource} leftId={current.id} rightId={other.id} onSelect={setNameSource} />
                  <MergeRow label="Телефон" left={current.phones[0] || "—"} right={other.phones[0] || "—"} />
                  <MergeRow label="Доп. телефон" left={current.phones[1] || "—"} right={other.phones[1] || "—"} />
                  <MergeRow label="Почта" left={current.emails[0] || "—"} right={other.emails[0] || "—"} />
                  <MergeRow label="Источник" left={current.source || "—"} right={other.source || "—"} />
                </div>
                <div className={styles.mergeTransfer}><span>Сделки, звонки, сообщения, заметки и теги переносятся целиком</span><small>{current.dealCount + other.dealCount} сделок · {current.phones.length + other.phones.length} телефонов · {current.emails.length + other.emails.length} почт</small></div>
                <div className={styles.mergeConfirmation}>
                  <strong>Будет сохранён: {survivor?.fullName}</strong>
                  <span>
                    Источник: {source?.fullName}. После слияния действие нельзя
                    отменить.
                  </span>
                </div>
                <p className={styles.mergeHint}>Действие необратимо: после объединения останется одна карточка.</p>
                {error && <p className={styles.mergeError}>{error}</p>}
                <footer className={styles.mergeFooter}>
                  <button type="button" onClick={close} disabled={submitting}>
                    Отмена
                  </button>
                  <button
                    type="button"
                    onClick={() => void submit()}
                    disabled={submitting}
                  >
                    {submitting ? "Объединение…" : <>Объединить <span className={styles.kbd}>⏎</span></>}
                  </button>
                </footer>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function MergeRow({
  label,
  left,
  right,
  selected,
  leftId,
  rightId,
  onSelect,
}: {
  label: string;
  left: string;
  right: string;
  selected?: string;
  leftId?: string;
  rightId?: string;
  onSelect?: (id: string) => void;
}) {
  const same = left === right && left !== "—";
  return (
    <div className={styles.mergeRow}>
      <span className={styles.mergeLabel}>{label}</span>
      <label className={`${styles.mergeValue} ${same ? styles.sameValue : ""}`}>
        {!same && onSelect && leftId && <input type="radio" name={`merge-${label}`} checked={selected === leftId} onChange={() => onSelect(leftId)} />}
        <span>{left}</span>{same && <small>совпадает</small>}
      </label>
      <label className={`${styles.mergeValue} ${same ? styles.sameValue : ""}`}>
        {!same && onSelect && rightId && <input type="radio" name={`merge-${label}`} checked={selected === rightId} onChange={() => onSelect(rightId)} />}
        <span>{right}</span>{same && <small>совпадает</small>}
      </label>
    </div>
  );
}

function initials(name: string): string {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(value));
}

function plural(value: number, one: string, few: string, many: string): string {
  const n = Math.abs(value) % 100;
  if (n >= 11 && n <= 19) return many;
  switch (n % 10) {
    case 1: return one;
    case 2:
    case 3:
    case 4: return few;
    default: return many;
  }
}

function findSource(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const field = value.find((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    return /source|источник|канал/i.test(`${row.field_name ?? ""} ${row.field_code ?? ""}`);
  });
  if (!field || typeof field !== "object") return null;
  const values = (field as Record<string, unknown>).values;
  if (!Array.isArray(values)) return null;
  const result = values.map((item) => {
    if (!item || typeof item !== "object") return "";
    const row = item as Record<string, unknown>;
    return typeof row.value === "string" || typeof row.value === "number" ? String(row.value) : String(row.enum ?? row.enum_code ?? "");
  }).filter(Boolean).join(", ");
  return result || null;
}
