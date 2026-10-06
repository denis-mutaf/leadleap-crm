"use client";

import { Check, List } from "lucide-react";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { dbErrorText } from "@/lib/db-errors";
import { useDismiss } from "@/lib/use-dismiss";
import styles from "./card-parts.module.css";

type Option = { id: string; name: string };

const selectIcon = <List size={14} className={styles.typeIcon} aria-hidden="true" />;

/**
 * Метки сделки: комбобокс с поиском, как в форме создания. Каждый щелчок — одна
 * запись в базу (добавить или снять), а не «стереть все и записать заново»:
 * так в ленте остаются ровно те метки, которые человек поменял.
 */
export function TagsField({ dealId, selected, options }: { dealId: string; selected: Option[]; options: Option[] }) {
  const router = useRouter();
  const [items, setItems] = useState(selected);
  const [syncedSelected, setSyncedSelected] = useState(selected);
  if (syncedSelected !== selected) { setSyncedSelected(selected); setItems(selected); }
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useDismiss(wrapRef, open, () => { setOpen(false); setSearch(""); });
  const query = search.trim().toLocaleLowerCase();
  const filtered = options.filter((tag) => tag.name.toLocaleLowerCase().includes(query));

  async function toggle(tag: Option) {
    if (busy) return;
    const has = items.some((item) => item.id === tag.id);
    const previous = items;
    setItems(has ? items.filter((item) => item.id !== tag.id) : [...items, tag]);
    setBusy(true);
    const db = createClient();
    const result = has
      ? await db.from("deal_tags").delete().eq("deal_id", dealId).eq("tag_id", tag.id)
      : await db.from("deal_tags").insert({ deal_id: dealId, tag_id: tag.id });
    setBusy(false);
    if (result.error) {
      setItems(previous);
      toast.error(dbErrorText(result.error, "Метки не сохранились. Попробуйте ещё раз."));
      return;
    }
    toast.success(`Метка «${tag.name}» ${has ? "снята" : "добавлена"}`);
    router.refresh();
  }

  return (
    <div className="field-row">
      <span>{selectIcon}Метки</span>
      <div className="create-deal-tag-control" ref={wrapRef}>
        <div className="create-deal-tag-chips">
          {items.length === 0 && <span className="create-deal-muted">—</span>}
          {items.map((tag) => (
            <button className="create-deal-chip" key={tag.id} type="button" aria-label={`Снять метку ${tag.name}`} disabled={busy} onClick={() => void toggle(tag)}>
              {tag.name} ×
            </button>
          ))}
          <button className="btn btn-ghost create-deal-add-tag" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            + Метка
          </button>
        </div>
        {open && (
          <div className="create-deal-tag-menu motion-popover">
            <input
              autoFocus
              aria-label="Поиск меток"
              placeholder="Поиск меток"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                const first = filtered.find((tag) => !items.some((item) => item.id === tag.id));
                if (first) { void toggle(first); setSearch(""); }
              }}
            />
            <div className="create-deal-tag-options">
              {filtered.length === 0 && <span className="create-deal-muted">Такой метки нет</span>}
              {filtered.map((tag) => {
                const picked = items.some((item) => item.id === tag.id);
                return (
                  <button className="create-deal-tag-option" key={tag.id} type="button" aria-pressed={picked} disabled={busy} onClick={() => void toggle(tag)}>
                    <span>{tag.name}</span>
                    {picked && <Check size={14} aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Проект — одиночный выбор из площадок (решение владельца 06.10). Данные
 * многопроектных сделок остаются как есть, пока их не поправит миграция
 * (тикет 51); первая правка здесь оставляет в сделке один выбранный проект.
 */
export function ProjectField({ dealId, selected, options }: { dealId: string; selected: Option[]; options: Option[] }) {
  const router = useRouter();
  const [items, setItems] = useState(selected);
  const [syncedSelected, setSyncedSelected] = useState(selected);
  if (syncedSelected !== selected) { setSyncedSelected(selected); setItems(selected); }
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  async function pick(projectId: string) {
    setEditing(false);
    if ((items.length === 1 && items[0].id === projectId) || (items.length === 0 && !projectId)) return;
    const previous = items;
    const next = options.find((option) => option.id === projectId);
    setItems(next ? [next] : []);
    setSaving(true);
    const result = await createClient().rpc("set_deal_project", { p_deal_id: dealId, p_project_id: projectId || null });
    setSaving(false);
    if (result.error) {
      setItems(previous);
      toast.error(dbErrorText(result.error, "Проект не сохранился. Попробуйте ещё раз."));
      return;
    }
    toast.success("Проект — сохранено");
    router.refresh();
  }

  const label = items.map((item) => item.name).join(", ");
  return (
    <div className={`field-row ${saving ? "field-saving" : ""}`}>
      <span>{selectIcon}Проект</span>
      {editing ? (
        <select className="field-select" autoFocus defaultValue={items[0]?.id ?? ""} onChange={(event) => void pick(event.target.value)} onBlur={() => setEditing(false)} onKeyDown={(event) => event.key === "Escape" && setEditing(false)}>
          <option value="">— не выбран —</option>
          {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      ) : (
        <button type="button" className={`field-value ${label ? "" : "is-empty"}`} onClick={() => setEditing(true)} title="Нажмите, чтобы изменить">
          {label || "—"}
        </button>
      )}
    </div>
  );
}
