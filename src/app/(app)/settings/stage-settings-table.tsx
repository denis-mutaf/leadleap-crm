"use client";

import { useState, useRef } from "react";
import { Ellipsis, GripVertical, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Stage, StageKind } from "@/lib/types";
import { dbErrorText } from "@/lib/db-errors";
import { StageIndicator } from "@/components/crm/stage-indicator";
import styles from "./settings.module.css";
import { useDismiss } from "@/lib/use-dismiss";

type Row = Stage & { counts: { total: number } };
type GateKey = "requires_next_step" | "requires_qualification_tag" | "requires_qualification";
// Уникальность позиции этапа — внутренняя причина, а не «такая запись уже есть».
function stageErrorText(error: unknown, fallback: string) {
  const record = error as { message?: unknown; code?: unknown } | null;
  const message = typeof record?.message === "string" ? record.message : "";
  if (message.includes("stages_position_idx")) return "Порядок этапов только что изменили — обновите страницу и повторите";
  if (record?.code === "42501" || /row-level security/i.test(message)) return "Менять этапы может только администратор";
  return dbErrorText(error, fallback);
}
const kindLabel = (kind: StageKind) => kind === "won" ? "успешный" : kind === "lost" ? "неуспешный" : "открытый";

function Toggle({ value, disabled, label, onClick }: { value: boolean; disabled: boolean; label: string; onClick: () => void }) {
  return <button type="button" className={`${styles.switch} ${value ? styles.on : ""}`} aria-label={label} aria-pressed={value} disabled={disabled} onClick={onClick} />;
}

function StageRow({ row, canEdit, menu, setMenu, onEdit, onToggle, onRemove, allStages }: { row: Row; canEdit: boolean; menu: string | null; setMenu: (id: string | null) => void; onEdit: (row: Row) => void; onToggle: (row: Row, key: GateKey) => void; onRemove: (row: Row) => void; allStages: readonly Row[] }) {
  const closed = row.kind !== "open";
  const { setNodeRef, transform, transition, attributes, listeners } = useSortable({ id: row.id, disabled: !canEdit || closed });
  const menuRef = useRef<HTMLTableCellElement>(null);
  useDismiss(menuRef, menu === row.id, () => setMenu(null));
  return <tr ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={closed ? styles.closed : undefined}>
    <td className={styles.grip}>{!closed && <button className={styles.dragHandle} {...attributes} {...listeners} disabled={!canEdit} aria-label={`Переместить ${row.name}`}><GripVertical size={14} /></button>}</td>
    <td><span className={styles.stageCell}><StageIndicator stage={row} stages={allStages} name={row.name} /></span></td>
    <td><span className={`${styles.kind} ${row.kind === "won" ? styles.kindWon : row.kind === "lost" ? styles.kindLost : ""}`}>{kindLabel(row.kind)}</span></td>
    <td><Toggle value={row.requires_next_step} disabled={!canEdit || closed} label={`${row.name}: требовать следующий шаг`} onClick={() => onToggle(row, "requires_next_step")} /></td>
    <td><Toggle value={row.requires_qualification_tag} disabled={!canEdit || closed} label={`${row.name}: требовать метку КВАЛ или неквал`} onClick={() => onToggle(row, "requires_qualification_tag")} /></td>
    <td><Toggle value={row.requires_qualification} disabled={!canEdit || closed} label={`${row.name}: требовать заполненные поля квалификации`} onClick={() => onToggle(row, "requires_qualification")} /></td>
    <td className={styles.count}><strong>{row.counts.total.toLocaleString("ru-RU")}</strong></td>
    <td className={styles.menuCell} ref={menuRef}>{canEdit && <button className={styles.menuButton} aria-label={`Действия: ${row.name}`} aria-expanded={menu === row.id} onClick={(event) => { event.stopPropagation(); setMenu(menu === row.id ? null : row.id); }}><Ellipsis size={16} /></button>}{menu === row.id && <div className={styles.menu} role="menu"><button onClick={() => onEdit(row)}>Переименовать</button>{row.kind === "open" && <button onClick={() => onRemove(row)}>Удалить</button>}</div>}</td>
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
  const [removing, setRemoving] = useState<Row | null>(null);
  // Скрытые этапы в воронке не участвуют: ни в списке, ни в порядке.
  const activeItems = items.filter((row) => row.is_active);
  const openRows = activeItems.filter((row) => row.kind === "open").sort((a, b) => a.position - b.position);
  const closedRows = activeItems.filter((row) => row.kind !== "open").sort((a, b) => a.position - b.position);

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
    } catch (cause) {
      setItems(previous); setError(stageErrorText(cause, "Не удалось изменить порядок"));
      // Часть этапов могла остаться на временных позициях — возвращаем прежние.
      const db = createClient();
      for (const row of openRows) await db.from("stages").update({ position: row.position }).eq("id", row.id);
    }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function toggle(row: Row, key: GateKey) {
    if (!canEdit || busyRef.current) return;
    const value = !row[key]; setItems((current) => current.map((item) => item.id === row.id ? { ...item, [key]: value } : item)); setBusy(true); busyRef.current = true; setError("");
    const result = await createClient().from("stages").update({ [key]: value }).eq("id", row.id);
    if (result.error) { setItems((current) => current.map((item) => item.id === row.id ? { ...item, [key]: row[key] } : item)); setError(stageErrorText(result.error, "Не удалось сохранить")); }
    busyRef.current = false; setBusy(false);
  }
  async function saveName() {
    if (!editing || !draft.trim() || busyRef.current) return;
    setBusy(true); busyRef.current = true; setError(""); const result = await createClient().from("stages").update({ name: draft.trim() }).eq("id", editing.id).select("name").single();
    if (result.error) setError(stageErrorText(result.error, "Не удалось переименовать этап")); else { setItems((current) => current.map((row) => row.id === editing.id ? { ...row, name: draft.trim() } : row)); setEditing(null); }
    busyRef.current = false; setBusy(false);
  }
  // Новый этап встаёт сразу после последнего открытого. Позиции уникальны
  // среди активных этапов, поэтому занятое место освобождаем сдвигом вверх —
  // закрытые («Договор», «Отказ») остаются в конце воронки.
  async function addStage() {
    const name = newName.trim();
    if (!name || busyRef.current) return;
    setBusy(true); busyRef.current = true; setError("");
    const db = createClient();
    try {
      const position = Math.max(-1, ...openRows.map((row) => row.position)) + 1;
      const shifted = activeItems.filter((row) => row.position >= position).sort((a, b) => b.position - a.position);
      const needShift = shifted.some((row) => row.position === position);
      const moved = needShift ? shifted : [];
      for (const row of moved) {
        const result = await db.from("stages").update({ position: row.position + 1 }).eq("id", row.id);
        if (result.error) throw result.error;
      }
      const result = await db.from("stages").insert({ name, position, kind: "open", requires_next_step: false, requires_qualification: false, requires_qualification_tag: false, is_active: true }).select("id,name,position,kind,requires_next_step,requires_qualification_tag,requires_qualification,is_active,created_at").single();
      if (result.error) throw result.error;
      setItems((current) => [...current.map((row) => moved.some((item) => item.id === row.id) ? { ...row, position: row.position + 1 } : row), { ...(result.data as Stage), counts: { total: 0 } }]);
      setNewName(""); setAdding(false);
    } catch (cause) { setError(stageErrorText(cause, "Не удалось добавить этап")); }
    busyRef.current = false; setBusy(false);
  }
  async function removeStage() {
    const row = removing;
    if (!row || busyRef.current) return;
    setBusy(true); busyRef.current = true; setError("");
    const db = createClient();
    // Этап с историей переходов физически удалить нельзя (внешний ключ) — тогда скрываем.
    const deleted = await db.from("stages").delete().eq("id", row.id).select("id");
    let gone = !deleted.error && (deleted.data?.length ?? 0) > 0;
    if (deleted.error?.code === "23503") {
      const hidden = await db.from("stages").update({ is_active: false }).eq("id", row.id).select("id");
      if (hidden.error) setError(stageErrorText(hidden.error, "Не удалось убрать этап")); else gone = (hidden.data?.length ?? 0) > 0;
    } else if (deleted.error) setError(stageErrorText(deleted.error, "Не удалось удалить этап"));
    else if (!gone) setError("Этап не удалён: нет прав или его уже изменили");
    if (gone) { setItems((current) => current.map((item) => item.id === row.id ? { ...item, is_active: false } : item)); setRemoving(null); }
    busyRef.current = false; setBusy(false);
  }
  function askRemove(row: Row) {
    setMenu(null); setError("");
    if (row.counts.total > 0) { setError(`В этапе «${row.name}» сделок: ${row.counts.total}. Сначала переведите их в другой этап`); return; }
    setRemoving(row);
  }
  return <>
    <DndContext id="crm-stage-settings" sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorder}>
      <table className={styles.table}><thead><tr><th aria-label="Перетаскивание" /><th>Этап</th><th>Вид</th><th>Требовать следующий шаг</th><th>Требовать метку КВАЛ</th><th>Требовать поля квалификации</th><th className={styles.countHead}>Сделок</th><th aria-label="Действия" /></tr></thead><tbody>
        <SortableContext items={openRows.map((row) => row.id)} strategy={verticalListSortingStrategy}>{openRows.map((row) => <StageRow key={row.id} row={row} canEdit={canEdit} menu={menu} setMenu={setMenu} onEdit={(item) => { setEditing(item); setDraft(item.name); }} onToggle={toggle} onRemove={askRemove} allStages={activeItems} />)}</SortableContext>
        {closedRows.length > 0 && <tr className={styles.groupDivider}><td colSpan={8}>Закрытые этапы</td></tr>}
        {closedRows.map((row) => <StageRow key={row.id} row={row} canEdit={canEdit} menu={menu} setMenu={setMenu} onEdit={(item) => { setEditing(item); setDraft(item.name); }} onToggle={toggle} onRemove={askRemove} allStages={activeItems} />)}
      </tbody></table>
    </DndContext>
    {canEdit && (adding ? <div className={styles.addForm}><input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Название этапа" onKeyDown={(event) => { if (event.key === "Enter") void addStage(); if (event.key === "Escape") setAdding(false); }} /><button className={styles.saveButton} onClick={() => void addStage()} disabled={busy}>Добавить</button><button className={styles.cancelButton} onClick={() => setAdding(false)}>Отмена</button></div> : <button className={styles.addRow} onClick={() => setAdding(true)}><Plus size={15} /> Этап</button>)}
    {editing && <div className={styles.inlineEdit}><input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveName(); if (event.key === "Escape") setEditing(null); }} /><button className={styles.saveButton} onClick={() => void saveName()} disabled={busy}>Сохранить</button><button className={styles.cancelButton} onClick={() => setEditing(null)}>Отмена</button></div>}
    {removing && <div className={styles.inlineEdit}><span>Удалить этап «{removing.name}»?</span><button className={styles.saveButton} onClick={() => void removeStage()} disabled={busy}>Удалить</button><button className={styles.cancelButton} onClick={() => setRemoving(null)} disabled={busy}>Отмена</button></div>}
    {error && <p className={styles.inlineError} role="alert">{error}</p>}
  </>;
}
