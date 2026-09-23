"use client";

import { useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DateField } from "@/components/crm/date-field";
import { createClient } from "@/lib/supabase/client";
import { dbErrorText } from "@/lib/db-errors";
import styles from "./contacts.module.css";

type Phone = { id: string; phone: string; is_primary: boolean };
type Email = { ordinal: number; email: string };
type AmoField = {
  field_id?: number | string;
  field_name?: string;
  field_code?: string;
  values?: Array<{ value?: unknown; enum?: string; enum_code?: string }>;
};
type CustomDefinition = {
  id: string;
  label: string;
  field_type: "text" | "number" | "date" | "select" | "checkbox";
  options: unknown;
};
type CustomValue = { id: string; field_id: string; value: unknown };

function valueText(field: AmoField): string {
  return (field.values ?? [])
    .map((value) => {
      if (typeof value.value === "string" || typeof value.value === "number")
        return String(value.value);
      return value.enum ?? value.enum_code ?? "";
    })
    .filter(Boolean)
    .join(", ");
}

export function ContactPhones({
  contactId,
  phones,
}: {
  contactId: string;
  phones: Phone[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function addPhone() {
    const phone = draft.trim();
    if (!phone || busy) return;
    setBusy("add");
    const result = await createClient().from("contact_phones").insert({
      contact_id: contactId,
      phone,
      is_primary: phones.length === 0,
    });
    if (result.error) toast.error(`Телефон не добавлен: ${dbErrorText(result.error)}`);
    else {
      toast.success("Телефон добавлен");
      setDraft("");
      setAdding(false);
      router.refresh();
    }
    setBusy(null);
  }

  async function removePhone(phone: Phone) {
    if (busy) return;
    setBusy(phone.id);
    const result = await createClient()
      .from("contact_phones")
      .delete()
      .eq("id", phone.id);
    if (result.error) toast.error(`Телефон не удалён: ${dbErrorText(result.error)}`);
    else {
      if (phone.is_primary && phones.length > 1) {
        await createClient()
          .from("contact_phones")
          .update({ is_primary: true })
          .eq("id", phones.find((item) => item.id !== phone.id)?.id ?? "");
      }
      toast.success("Телефон удалён");
      router.refresh();
    }
    setBusy(null);
  }

  async function makePrimary(phone: Phone) {
    if (phone.is_primary || busy) return;
    setBusy(phone.id);
    const db = createClient();
    const reset = await db
      .from("contact_phones")
      .update({ is_primary: false })
      .eq("contact_id", contactId);
    const result = reset.error
      ? reset
      : await db.from("contact_phones").update({ is_primary: true }).eq("id", phone.id);
    if (result.error) toast.error(`Основной телефон не изменён: ${dbErrorText(result.error)}`);
    else {
      toast.success("Основной телефон изменён");
      router.refresh();
    }
    setBusy(null);
  }

  return (
    <div className={styles.collection}>
      {phones.map((phone) => (
        <div className={styles.collectionRow} key={phone.id}>
          <button
            type="button"
            className={`${styles.collectionValue} ${phone.is_primary ? styles.primaryValue : ""}`}
            onClick={() => void makePrimary(phone)}
            title={phone.is_primary ? "Основной телефон" : "Сделать основным"}
            disabled={busy !== null}
          >
            <span>{phone.phone}</span>
            {phone.is_primary && <span className={styles.primaryLabel}>основной</span>}
          </button>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={`Удалить телефон ${phone.phone}`}
            onClick={() => void removePhone(phone)}
            disabled={busy !== null}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      {adding ? (
        <div className={styles.addRow}>
          <input
            autoFocus
            className={styles.compactInput}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void addPhone();
              if (event.key === "Escape") setAdding(false);
            }}
            placeholder="+373 ..."
            aria-label="Новый телефон"
          />
          <button type="button" className={styles.iconButton} onClick={() => void addPhone()} disabled={!draft.trim() || busy !== null} aria-label="Сохранить телефон">
            <Check size={14} />
          </button>
          <button type="button" className={styles.iconButton} onClick={() => setAdding(false)} aria-label="Отменить добавление">
            <X size={14} />
          </button>
        </div>
      ) : (
        <button type="button" className={styles.addButton} onClick={() => setAdding(true)}>
          <Plus size={14} /> Добавить телефон
        </button>
      )}
    </div>
  );
}

export function ContactEmails({
  contactId,
  emails,
}: {
  contactId: string;
  emails: Email[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<number | "add" | null>(null);

  async function addEmail() {
    const email = draft.trim();
    if (!email || busy) return;
    setBusy("add");
    const ordinal = Math.max(-1, ...emails.map((item) => item.ordinal)) + 1;
    const result = await createClient().from("contact_emails").insert({ contact_id: contactId, ordinal, email });
    if (result.error) toast.error(`Почта не добавлена: ${dbErrorText(result.error)}`);
    else {
      toast.success("Почта добавлена");
      setDraft("");
      setAdding(false);
      router.refresh();
    }
    setBusy(null);
  }

  async function removeEmail(email: Email) {
    if (busy !== null) return;
    setBusy(email.ordinal);
    const result = await createClient()
      .from("contact_emails")
      .delete()
      .eq("contact_id", contactId)
      .eq("ordinal", email.ordinal);
    if (result.error) toast.error(`Почта не удалена: ${dbErrorText(result.error)}`);
    else {
      toast.success("Почта удалена");
      router.refresh();
    }
    setBusy(null);
  }

  return (
    <div className={styles.collection}>
      {emails.map((email) => (
        <div className={styles.collectionRow} key={email.ordinal}>
          <span className={styles.collectionValue}>{email.email}</span>
          <button type="button" className={styles.iconButton} aria-label={`Удалить почту ${email.email}`} onClick={() => void removeEmail(email)} disabled={busy !== null}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      {adding ? (
        <div className={styles.addRow}>
          <input autoFocus className={styles.compactInput} type="email" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void addEmail(); if (event.key === "Escape") setAdding(false); }} placeholder="name@example.com" aria-label="Новая почта" />
          <button type="button" className={styles.iconButton} onClick={() => void addEmail()} disabled={!draft.trim() || busy !== null} aria-label="Сохранить почту"><Check size={14} /></button>
          <button type="button" className={styles.iconButton} onClick={() => setAdding(false)} aria-label="Отменить добавление"><X size={14} /></button>
        </div>
      ) : (
        <button type="button" className={styles.addButton} onClick={() => setAdding(true)}><Plus size={14} /> Добавить почту</button>
      )}
    </div>
  );
}

export function EditableAmoField({
  contactId,
  fields,
  field,
  index,
}: {
  contactId: string;
  fields: AmoField[];
  field: AmoField;
  index: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(valueText(field));
  const [saving, setSaving] = useState(false);
  const label = field.field_name || field.field_code || `Поле Amo ${field.field_id ?? index + 1}`;
  const value = valueText(field);

  async function save() {
    if (saving) return;
    const next = draft.trim();
    const nextFields = fields.map((item, itemIndex) => itemIndex === index ? {
      ...item,
      values: [{ ...(item.values?.[0] ?? {}), value: next }],
    } : item);
    setEditing(false);
    setSaving(true);
    const result = await createClient().from("contacts").update({ amo_custom_fields: nextFields }).eq("id", contactId);
    setSaving(false);
    if (result.error) toast.error(`Поле не сохранено: ${dbErrorText(result.error, "Не удалось сохранить поле")}`);
    else {
      toast.success(`${label} — сохранено`);
      router.refresh();
    }
  }

  return (
    <div className={`${styles.customField} ${saving ? styles.saving : ""}`}>
      <span>{label}</span>
      {editing ? (
        <input autoFocus className={styles.customInput} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => void save()} onKeyDown={(event) => { if (event.key === "Enter") void save(); if (event.key === "Escape") { setDraft(value); setEditing(false); } }} />
      ) : (
        <button type="button" className={`${styles.customValue} ${!value ? styles.emptyValue : ""}`} onClick={() => { setDraft(value); setEditing(true); }}>
          {value || "—"}<Pencil size={12} />
        </button>
      )}
    </div>
  );
}

export function EditableCustomField({
  contactId,
  definition,
  current,
}: {
  contactId: string;
  definition: CustomDefinition;
  current: CustomValue | undefined;
}) {
  const router = useRouter();
  const initial = customValueText(current?.value);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const options = Array.isArray(definition.options)
    ? definition.options.map((option) => typeof option === "string" ? { value: option, label: option } : option && typeof option === "object" && "value" in option ? { value: String(option.value), label: String((option as { label?: unknown }).label ?? option.value) } : null).filter((option): option is { value: string; label: string } => option !== null)
    : [];

  async function save(next = draft) {
    if (saving) return;
    const value = next.trim();
    setEditing(false);
    setSaving(true);
    const parsed = definition.field_type === "number" && value ? Number(value) : definition.field_type === "checkbox" ? value === "true" : value || null;
    const result = await createClient().from("custom_field_values").upsert({ field_id: definition.id, entity_id: contactId, value: parsed }, { onConflict: "field_id,entity_id" });
    setSaving(false);
    if (result.error) toast.error(`Поле не сохранено: ${dbErrorText(result.error, "Не удалось сохранить поле")}`);
    else {
      toast.success(`${definition.label} — сохранено`);
      router.refresh();
    }
  }

  return (
    <div className={`${styles.customField} ${saving ? styles.saving : ""}`}>
      <span>{definition.label}</span>
      {editing ? definition.field_type === "select" && options.length ? (
        <select autoFocus className={styles.customInput} value={draft} onChange={(event) => { setDraft(event.target.value); void save(); }} onBlur={() => void save()}>
          <option value="">— не выбрано —</option>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      ) : definition.field_type === "date" ? (
        <DateField className={styles.customInput} value={draft} onChange={(next) => { setDraft(next); void save(next); }} onClose={() => setEditing(false)} defaultOpen clearable aria-label={definition.label} placeholder="—" />
      ) : (
        <input autoFocus className={styles.customInput} type={definition.field_type === "number" ? "number" : "text"} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => void save()} onKeyDown={(event) => { if (event.key === "Enter") void save(); if (event.key === "Escape") { setDraft(initial); setEditing(false); } }} />
      ) : (
        <button type="button" className={`${styles.customValue} ${!initial ? styles.emptyValue : ""}`} onClick={() => { setDraft(initial); setEditing(true); }}>
          {initial || "—"}<Pencil size={12} />
        </button>
      )}
    </div>
  );
}

function customValueText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  return JSON.stringify(value);
}

export function ContactTags({
  contactId,
  tags,
  allTags,
}: {
  contactId: string;
  tags: Array<{ id: string; name: string }>;
  allTags: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const available = allTags.filter((tag) => !tags.some((selected) => selected.id === tag.id));
  async function addTag(tagId: string) {
    setBusy(true);
    const result = await createClient().from("contact_tags").insert({ contact_id: contactId, tag_id: tagId });
    if (result.error) toast.error(`Метка не добавлена: ${dbErrorText(result.error)}`);
    else router.refresh();
    setBusy(false);
  }
  async function removeTag(tagId: string) {
    setBusy(true);
    const result = await createClient().from("contact_tags").delete().eq("contact_id", contactId).eq("tag_id", tagId);
    if (result.error) toast.error(`Метка не удалена: ${dbErrorText(result.error)}`);
    else router.refresh();
    setBusy(false);
  }
  return (
    <div className={styles.tagEditor}>
      <div className={styles.tagList}>
        {tags.map((tag) => <span className={styles.tag} key={tag.id}>{tag.name}<button type="button" onClick={() => void removeTag(tag.id)} disabled={busy} aria-label={`Удалить метку ${tag.name}`}><X size={12} /></button></span>)}
      </div>
      <button type="button" className={styles.addButton} onClick={() => setOpen((value) => !value)}><Plus size={14} /> Добавить метку</button>
      {open && <div className={styles.tagPicker} role="listbox">{available.length ? available.map((tag) => <button type="button" key={tag.id} onClick={() => void addTag(tag.id)} disabled={busy}>{tag.name}</button>) : <span>Все метки уже добавлены</span>}</div>}
    </div>
  );
}
