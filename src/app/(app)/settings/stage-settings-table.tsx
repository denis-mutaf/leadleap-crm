"use client";

import { useState, useRef } from "react";
import { Ellipsis, GripVertical, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Stage, StageKind } from "@/lib/types";
import styles from "./settings.module.css";

type Row = Stage & { counts: { total: number } };
type GateKey = "requires_next_step" | "requires_qualification_tag";
const kindLabel = (kind: StageKind) => kind === "won" ? "успешный" : kind === "lost" ? "неуспешный" : "открытый";

function Toggle({ value, disabled, label, onClick }: { value: boolean; disabled: boolean; label: string; onClick: () => void }) {
  return <button type="button" className={`${styles.switch} ${value ? styles.on : ""}`} aria-label={label} aria-pressed={value} disabled={disabled} onClick={onClick} />;
}

function StageRow({ row, canEdit, menu, setMenu, onEdit, onToggle }: { row: Row; canEdit: boolean; menu: string | null; setMenu: (id: string | null) => void; onEdit: (row: Row) => void; onToggle: (row: Row, key: GateKey) => void }) {
  const closed = row.kind !== "open";
  const sortable = useSortable({ id: row.id, disabled: !canEdit || closed });
  return <tr ref={sortable.setNodeRef} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }} className={closed ? styles.closed : undefined}>
    <td className={styles.grip}>{!closed && <button className={styles.dragHandle} {...sortable.attributes} {...sortable.listeners} disabled={!canEdit} aria-label={`Переместить ${row.name}`}><GripVertical size={14} /></button>}</td>
    <td><span className={`${styles.dot} ${row.kind === "won" ? styles.dotWon : row.kind === "lost" ? styles.dotLost : ""}`} />{row.name}</td>
    <td><span className={`${styles.kind} ${row.kind === "won" ? styles.kindWon : row.kind === "lost" ? styles.kindLost : ""}`}>{kindLabel(row.kind)}</span></td>
    <td><Toggle value={row.requires_next_step} disabled={!canEdit || closed} label={`${row.name}: требовать следующий шаг`} onClick={() => onToggle(row, "requires_next_step")} /></td>
    <td><Toggle value={row.requires_qualification_tag} disabled={!canEdit} label={`${row.name}: требовать квалификацию`} onClick={() => onToggle(row, "requires_qualification_tag")} /></td>
    <td className={styles.count}><strong>{row.counts.total.toLocaleString("ru-RU")}</strong></td>
    <td className={styles.menuCell}>{canEdit && <button className={styles.menuButton} aria-label={`Действия: ${row.name}`} aria-expanded={menu === row.id} onClick={(event) => { event.stopPropagation(); setMenu(menu === row.id ? null : row.id); }}><Ellipsis size={16} /></button>}{menu === row.id && <div className={styles.menu} role="menu"><button onClick={() => onEdit(row)}>Переименовать</button></div>}</td>
  </tr>;
}

export function StageTable({ rows, canEdit }: { rows: Row[]; canEdit: boolean }) {
  const [items, setItems] = useState(rows);
  const [menu, setMenu] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const busyRef = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const openRows = items.filter((row) => row.kind === "open").sort((a, b) => a.position - b.position);
  const closedRows = items.filter((row) => row.kind !== "open").sort((a, b) => a.position - b.position);

  async function reorder(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id || busyRef.current) return;
    const from = openRows.findIndex((row) => row.id === event.active.id), to = openRows.findIndex((row) => row.id === event.over?.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(openRows, from, to).map((row, index) => ({ ...row, position: index }));
    const previous = items; setItems([...next, ...closedRows]); setBusy(true); busyRef.current = true; setError("");
    try {
      const db = createClient();
      const temp = await Promise.all(openRows.map((row, index) => db.from("stages").update({ position: -(index + 1) }).eq("id", row.id)));
      if (temp.some((result) => result.error)) throw temp.find((result) => result.error)?.error;
      const final = await Promise.all(next.map((row) => db.from("stages").update({ position: row.position }).eq("id", row.id)));
      if (final.some((result) => result.error)) throw final.find((result) => result.error)?.error;
    } catch (cause) { setItems(previous); setError(cause instanceof Error ? cause.message : "Не удалось изменить порядок"); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function toggle(row: Row, key: GateKey) {
    if (!canEdit || busyRef.current) return;
    const value = !row[key]; setItems((current) => current.map((item) => item.id === row.id ? { ...item, [key]: value } : item)); setBusy(true); busyRef.current = true; setError("");
    const result = await createClient().from("stages").update({ [key]: value }).eq("id", row.id);
    if (result.error) { setItems((current) => current.map((item) => item.id === row.id ? { ...item, [key]: row[key] } : item)); setError(result.error.message); }
    busyRef.current = false; setBusy(false);
  }
  async function saveName() {
    if (!editing || !draft.trim() || busyRef.current) return;
    setBusy(true); busyRef.current = true; setError(""); const result = await createClient().from("stages").update({ name: draft.trim() }).eq("id", editing.id).select("name").single();
    if (result.error) setError(result.error.message); else { setItems((current) => current.map((row) => row.id === editing.id ? { ...row, name: draft.trim() } : row)); setEditing(null); }
    busyRef.current = false; setBusy(false);
  }
  async function addStage() {
    if (!newName.trim() || busyRef.current) return;
    setBusy(true); busyRef.current = true; setError(""); const result = await createClient().from("stages").insert({ name: newName.trim(), position: openRows.length, kind: "open", requires_next_step: false, requires_qualification: false, requires_qualification_tag: false, is_active: true }).select("id,name,position,kind,requires_next_step,requires_qualification_tag,requires_qualification,is_active,created_at").single();
    if (result.error) setError(result.error.message); else { setItems((current) => [...current, { ...(result.data as Stage), counts: { total: 0 } }]); setNewName(""); setAdding(false); }
    busyRef.current = false; setBusy(false);
  }
  return <>
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorder}>
      <table className={styles.table}><thead><tr><th aria-label="Перетаскивание" /><th>Этап</th><th>Вид</th><th>Требовать следующий шаг</th><th>Требовать квалификацию</th><th className={styles.countHead}>Сделок</th><th aria-label="Действия" /></tr></thead><tbody>
        <SortableContext items={openRows.map((row) => row.id)} strategy={verticalListSortingStrategy}>{openRows.map((row) => <StageRow key={row.id} row={row} canEdit={canEdit} menu={menu} setMenu={setMenu} onEdit={(item) => { setEditing(item); setDraft(item.name); }} onToggle={toggle} />)}</SortableContext>
        {openRows.length > 0 && <tr><td colSpan={7}><div className={styles.dropPlaceholder} /></td></tr>}
        {closedRows.map((row) => <StageRow key={row.id} row={row} canEdit={canEdit} menu={menu} setMenu={setMenu} onEdit={(item) => { setEditing(item); setDraft(item.name); }} onToggle={toggle} />)}
      </tbody></table>
    </DndContext>
    {canEdit && (adding ? <div className={styles.addForm}><input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Название этапа" onKeyDown={(event) => { if (event.key === "Enter") void addStage(); if (event.key === "Escape") setAdding(false); }} /><button className={styles.saveButton} onClick={() => void addStage()} disabled={busy}>Добавить</button><button className={styles.cancelButton} onClick={() => setAdding(false)}>Отмена</button></div> : <button className={styles.addRow} onClick={() => setAdding(true)}><Plus size={15} /> Этап</button>)}
    {editing && <div className={styles.inlineEdit}><input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveName(); if (event.key === "Escape") setEditing(null); }} /><button className={styles.saveButton} onClick={() => void saveName()} disabled={busy}>Сохранить</button><button className={styles.cancelButton} onClick={() => setEditing(null)}>Отмена</button></div>}
    {error && <p className={styles.inlineError} role="alert">{error}</p>}
  </>;
}
