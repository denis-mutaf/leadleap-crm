"use client";

import { useEffect, useRef, useState } from "react";
import { Globe, GripVertical, Info, MoreHorizontal, Plus, X } from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import styles from "./fields.module.css";

export type FieldRow = {
  id: string;
  entity: "deal" | "contact";
  key: string;
  label: string;
  field_type: string;
  options: string[] | null;
  position: number;
  is_required: boolean;
  is_active: boolean;
  auto_created: boolean;
  total: number;
  filled: number;
};
const labels: Record<string, string> = {
  text: "текст",
  number: "число",
  date: "дата",
  select: "список",
  checkbox: "чекбокс",
};
const blank = {
  label: "",
  field_type: "select",
  options: [""],
  is_required: false,
};

/* eslint-disable react-hooks/refs -- dnd-kit exposes sortable refs/listeners for render wiring. */
function SortableRow({
  row,
  canEdit,
  menu,
  setMenu,
  onEdit,
  onHide,
  onDelete,
  total,
  noun,
}: {
  row: FieldRow;
  canEdit: boolean;
  menu: string | null;
  setMenu: (id: string | null) => void;
  onEdit: (row: FieldRow) => void;
  onHide: () => void;
  onDelete: () => void;
  total: number;
  noun: string;
}) {
  const sortable = useSortable({ id: row.id, disabled: !canEdit });
  const percent = total ? (row.filled / total) * 100 : 0;
  return (
    <tr
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
    >
      <td className={styles.fieldName}>
        <button
          className={styles.dragHandle}
          {...sortable.attributes}
          {...sortable.listeners}
          disabled={!canEdit}
          aria-label={`Переместить ${row.label}`}
        >
          <GripVertical size={14} />
        </button>
        {row.label}
      </td>
      <td>
        <span className={styles.chip}>
          {labels[row.field_type] || row.field_type}
        </span>
      </td>
      <td>
        {row.auto_created ? (
          <span className={styles.chip}>
            <Globe size={12} /> Форма сайта
          </span>
        ) : (
          "вручную"
        )}
      </td>
      <td>
        <span className={styles.switch}>{row.is_required ? "Да" : "Нет"}</span>
      </td>
      <td>
        <span className={styles.fillLabel}>
          {percent.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} %{" "}
          {noun}
        </span>
        <span className={styles.bar} aria-hidden="true">
          <i style={{ width: `${Math.min(percent, 100)}%`, minWidth: percent > 0 ? 4 : 0 }} />
        </span>
      </td>
      <td className={styles.menuCell}>
        {canEdit && (
          <button
            className={styles.icon}
            aria-label={`Действия: ${row.label}`}
            aria-expanded={menu === row.id}
            onClick={() => setMenu(menu === row.id ? null : row.id)}
          >
            <MoreHorizontal size={16} />
          </button>
        )}
        {menu === row.id && canEdit && (
          <div className={styles.menu} role="menu">
            <button onClick={() => onEdit(row)}>Изменить</button>
            <button onClick={onHide}>Скрыть</button>
            <button className={styles.danger} onClick={onDelete}>
              Удалить
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
/* eslint-enable react-hooks/refs */

export default function FieldsClient({
  initialRows,
  canEdit,
  totals,
}: {
  initialRows: FieldRow[];
  canEdit: boolean;
  totals: { deal: number; contact: number };
}) {
  const [rows, setRows] = useState(initialRows);
  const [entity, setEntity] = useState<"deal" | "contact">("deal");
  const [menu, setMenu] = useState<string | null>(null);
  const [panel, setPanel] = useState<"create" | FieldRow | null>(null);
  const [confirm, setConfirm] = useState<"hide" | "delete" | null>(null);
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const busyRef = useRef(false);
  const panelRef = useRef<HTMLFormElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const total = totals[entity];
  const active = rows
    .filter((row) => row.entity === entity && row.is_active)
    .sort((left, right) => left.position - right.position);
  const historical = rows.filter(
    (row) => row.entity === entity && !row.is_active,
  );
  const noun = entity === "contact" ? "контактов" : "сделок";
  async function reorder(event: DragEndEvent) {
    if (
      !event.over ||
      event.active.id === event.over.id ||
      busyRef.current ||
      !canEdit
    )
      return;
    const from = active.findIndex((row) => row.id === event.active.id);
    const to = active.findIndex((row) => row.id === event.over?.id);
    if (from < 0 || to < 0) return;
    const next = [...active];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const previous = rows;
    const reordered = next.map((row, index) => ({ ...row, position: index }));
    setRows([
      ...reordered,
      ...rows.filter((row) => row.entity !== entity || !row.is_active),
    ]);
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await api("POST", {
        action: "reorder",
        entity,
        field_ids: reordered.map((row) => row.id),
      });
      setRows((items) =>
        items.map((row) => {
          const updated = reordered.find((item) => item.id === row.id);
          return updated || row;
        }),
      );
    } catch (cause) {
      setRows(previous);
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось изменить порядок полей",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!panel && !confirm) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPanel(null);
        setConfirm(null);
        setMenu(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panel, confirm]);
  useEffect(() => {
    if (panel) panelRef.current?.querySelector("input")?.focus();
  }, [panel]);
  async function api(method: string, body: object) {
    const response = await fetch("/api/settings/fields", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "Не удалось сохранить изменения");
    return data;
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const body =
        panel === "create"
          ? { ...form, entity }
          : {
              id: (panel as FieldRow).id,
              label: form.label,
              ...(form.field_type === "select"
                ? { options: form.options }
                : {}),
              is_required: form.is_required,
            };
      const data = await api(panel === "create" ? "POST" : "PATCH", body);
      if (panel === "create")
        setRows((items) => [...items, { ...data.field, total, filled: 0 }]);
      else
        setRows((items) =>
          items.map((row) =>
            row.id === (panel as FieldRow).id ? { ...row, ...data.field } : row,
          ),
        );
      setPanel(null);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ошибка");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function action() {
    const row = rows.find((item) => item.id === menu);
    if (!row || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      if (confirm === "delete") {
        const data = await api("DELETE", {
          id: row.id,
          confirm: true,
          filled: row.filled,
        });
        setRows((items) => items.filter((item) => item.id !== data.id));
      } else {
        const data = await api("PATCH", { id: row.id, is_active: false });
        setRows((items) =>
          items.map((item) =>
            item.id === row.id ? { ...item, ...data.field } : item,
          ),
        );
      }
      setConfirm(null);
      setMenu(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ошибка");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function edit(row: FieldRow) {
    setForm({
      label: row.label,
      field_type: row.field_type,
      options: row.options?.length ? row.options : [""],
      is_required: row.is_required,
    });
    setPanel(row);
    setMenu(null);
  }
  async function restore(row: FieldRow) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const data = await api("PATCH", { id: row.id, is_active: true });
      if (data.field)
        setRows((items) =>
          items.map((item) =>
            item.id === row.id ? { ...item, ...data.field } : item,
          ),
        );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось восстановить поле",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return (
    <div className={`${styles.page} settings-content`}>
      <header className={styles.header}>
        <div>
          <h1>Поля карточки</h1>
          <p>Новые поля формы сайта появляются здесь сами</p>
        </div>
        {canEdit && (
          <button
            className={styles.primary}
            onClick={() => {
              setForm(blank);
              setPanel("create");
            }}
          >
            <Plus size={15} /> Поле
          </button>
        )}
      </header>
      <main className={styles.card}>
        <div className={styles.tabs}>
          <button
            className={entity === "deal" ? styles.selected : ""}
            onClick={() => setEntity("deal")}
          >
            Сделка
          </button>
          <button
            className={entity === "contact" ? styles.selected : ""}
            onClick={() => setEntity("contact")}
          >
            Контакт
          </button>
        </div>
        <DndContext
          id="crm-fields-order"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={reorder}
        >
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Поле</th>
                <th>Тип</th>
                <th>Источник</th>
                <th>Обязательное</th>
                <th>Заполнено</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <SortableContext
                items={active.map((item) => item.id)}
                strategy={verticalListSortingStrategy}
              >
                {active.map((item) => (
                  <SortableRow
                    key={item.id}
                    row={item}
                    canEdit={canEdit}
                    menu={menu}
                    setMenu={setMenu}
                    onEdit={edit}
                    onHide={() => setConfirm("hide")}
                    onDelete={() => setConfirm("delete")}
                    total={total}
                    noun={noun}
                  />
                ))}
              </SortableContext>
            </tbody>
          </table>
        </DndContext>
        {historical.length > 0 && (
          <>
            <h2 className={styles.sectionTitle}>Исторические поля</h2>
            <table className={styles.table}>
              <tbody>
                {historical.map((item) => (
                  <tr key={item.id} className={styles.dim}>
                    <td>{item.label}</td>
                    <td>
                      <span className={styles.chip}>
                        {labels[item.field_type]}
                      </span>
                    </td>
                    <td>скрыто</td>
                    <td colSpan={2}>данные сохранены</td>
                    <td>
                      {canEdit && (
                        <button
                          className={styles.icon}
                          disabled={busy}
                          onClick={() => restore(item)}
                          aria-label={`Восстановить ${item.label}`}
                        >
                          ↗
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {canEdit && (
          <button
            className={styles.addRow}
            onClick={() => {
              setForm(blank);
              setPanel("create");
            }}
          >
            <Plus size={15} /> Поле
          </button>
        )}
      </main>
      <aside className={styles.note}>
        <Info size={16} />
        <span>
          Поле можно скрыть — данные останутся. Удаление стирает значения во
          всех {noun} и не отменяется.
        </span>
      </aside>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {panel && (
        <form className={styles.panel} ref={panelRef} onSubmit={submit}>
          <div className={styles.panelHead}>
            <strong>
              {panel === "create" ? "Новое поле" : "Изменить поле"}
            </strong>
            <button
              type="button"
              className={styles.icon}
              onClick={() => setPanel(null)}
              aria-label="Закрыть"
            >
              <X size={16} />
            </button>
          </div>
          <div className={styles.panelBody}>
            {panel !== "create" && (panel as FieldRow).auto_created && (
              <p className={styles.warning} role="note">
                Это поле пришло из формы сайта. Проверьте интеграцию перед
                переименованием.
              </p>
            )}
            <label>
              Название
              <input
                required
                maxLength={120}
                value={form.label}
                onChange={(event) =>
                  setForm({ ...form, label: event.target.value })
                }
              />
            </label>
            <label>
              Тип
              <select
                disabled={panel !== "create"}
                value={form.field_type}
                onChange={(event) =>
                  setForm({ ...form, field_type: event.target.value })
                }
              >
                {Object.entries(labels).map(([key, value]) => (
                  <option key={key} value={key}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            {form.field_type === "select" && (
              <label>
                Варианты списка
                {form.options.map((option, index) => (
                  <span className={styles.option} key={index}>
                    <input
                      required
                      value={option}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          options: form.options.map((x, i) =>
                            i === index ? event.target.value : x,
                          ),
                        })
                      }
                    />
                    <button
                      type="button"
                      className={styles.icon}
                      onClick={() =>
                        setForm({
                          ...form,
                          options: form.options.filter((_, i) => i !== index),
                        })
                      }
                      aria-label="Удалить вариант"
                    >
                      <X size={14} />
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  className={styles.addOption}
                  onClick={() =>
                    setForm({ ...form, options: [...form.options, ""] })
                  }
                >
                  + Вариант
                </button>
              </label>
            )}
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={form.is_required}
                onChange={(event) =>
                  setForm({ ...form, is_required: event.target.checked })
                }
              />{" "}
              Обязательное
            </label>
          </div>
          <div className={styles.panelFoot}>
            <button type="button" onClick={() => setPanel(null)}>
              Отмена
            </button>
            <button className={styles.primary} disabled={busy}>
              {busy ? "Сохранение…" : "Сохранить"}
            </button>
          </div>
        </form>
      )}
      {confirm && menu && (
        <div className={styles.modalBackdrop}>
          <section className={styles.modal} role="dialog" aria-modal="true">
            <h2>{confirm === "delete" ? "Удалить поле?" : "Скрыть поле?"}</h2>
            <p>
              {confirm === "delete"
                ? `Удалятся значения в ${rows.find((item) => item.id === menu)?.filled ?? 0} записях. Это нельзя отменить.`
                : "Данные останутся, поле можно будет восстановить."}
            </p>
            <div className={styles.modalActions}>
              <button onClick={() => setConfirm(null)}>Отмена</button>
              <button
                className={
                  confirm === "delete" ? styles.dangerButton : styles.primary
                }
                onClick={action}
              >
                {confirm === "delete" ? "Удалить навсегда" : "Скрыть поле"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
