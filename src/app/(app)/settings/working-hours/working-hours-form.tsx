"use client";

import { Lock, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { DateField } from "@/components/crm/date-field";
import { dbErrorText } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/client";
import { MAX_SLA_MINUTES, WEEK_DAYS, workingHoursError, type WorkingHours } from "@/lib/working-hours";
import settings from "../settings.module.css";
import styles from "./working-hours.module.css";

const dateLabel = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
};

export function WorkingHoursForm({ canEdit, currentUserId, initialHours, initialMinutes }: { canEdit: boolean; currentUserId: string; initialHours: WorkingHours; initialMinutes: number }) {
  const router = useRouter();
  const [hours, setHours] = useState(initialHours);
  const [minutesText, setMinutesText] = useState(String(initialMinutes));
  const [newHoliday, setNewHoliday] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const busyRef = useRef(false);

  const touch = () => { setSaved(false); setError(""); };
  const setSlot = (key: string, patch: Partial<{ start: string; end: string }> | null) => {
    touch();
    setHours((current) => ({ ...current, days: { ...current.days, [key]: patch === null ? null : { ...(current.days[key] ?? { start: "09:00", end: "18:00" }), ...patch } } }));
  };
  const addHoliday = () => {
    if (!newHoliday) return;
    touch();
    setHours((current) => ({ ...current, holidays: [...new Set([...current.holidays, newHoliday.slice(0, 10)])].sort() }));
    setNewHoliday("");
  };

  async function save() {
    if (busyRef.current || !canEdit) return;
    const minutes = Number(minutesText);
    const problem = workingHoursError(hours, minutes);
    if (problem) { setError(problem); return; }
    busyRef.current = true;
    setBusy(true);
    setError("");
    // Обе настройки одним запросом: либо сохранились обе, либо ни одна.
    const { error: failure } = await createClient().from("settings").upsert([
      { key: "working_hours", value: hours, updated_by: currentUserId, updated_at: new Date().toISOString() },
      { key: "sla_first_response", value: { minutes }, updated_by: currentUserId, updated_at: new Date().toISOString() },
    ], { onConflict: "key" });
    busyRef.current = false;
    setBusy(false);
    if (failure) { setError(dbErrorText(failure, "Не удалось сохранить расписание")); return; }
    setSaved(true);
    router.refresh();
  }

  return (
    <section className={settings.placeholder}>
      <header className={settings.subhead}>
        <div>
          <h1>Рабочие часы</h1>
          <p>Расписание отдела: по нему считается срок первого ответа на заявку. Часовой пояс — {hours.tz}</p>
        </div>
      </header>
      <div className={styles.body}>
        {!canEdit && <div className={styles.readOnly}><Lock size={14} aria-hidden="true" />Менять расписание может только администратор</div>}

        <div className={styles.card}>
          <h2>Срок первого ответа</h2>
          <p className={styles.hint}>Сколько рабочих минут менеджеру даётся на первый ответ. Заявка, пришедшая ночью или в выходной, отсчитывает срок с начала ближайшего рабочего дня. После просрочки руководителям уходит уведомление.</p>
          <label className={styles.minutes}>
            <input className={styles.field} type="number" inputMode="numeric" min={1} max={MAX_SLA_MINUTES} step={1} value={minutesText} disabled={!canEdit} aria-label="Срок первого ответа, минут" onChange={(event) => { touch(); setMinutesText(event.target.value); }} />
            мин рабочего времени
          </label>
        </div>

        <div className={styles.card}>
          <h2>График по дням недели</h2>
          <div className={styles.days}>
            {WEEK_DAYS.map(({ key, label }) => {
              const slot = hours.days[key];
              return (
                <div className={`${styles.day} ${slot ? "" : styles.off}`} key={key}>
                  <button type="button" className={`${settings.switch} ${slot ? settings.on : ""}`} aria-pressed={Boolean(slot)} aria-label={`${label}: рабочий день`} disabled={!canEdit} onClick={() => setSlot(key, slot ? null : {})} />
                  <span>{label}</span>
                  {slot ? (
                    <span className={styles.range}>
                      с <input className={styles.field} type="time" value={slot.start} disabled={!canEdit} aria-label={`${label}: начало`} onChange={(event) => setSlot(key, { start: event.target.value })} />
                      до <input className={styles.field} type="time" value={slot.end} disabled={!canEdit} aria-label={`${label}: конец`} onChange={(event) => setSlot(key, { end: event.target.value })} />
                    </span>
                  ) : <span className={styles.dayOff}>Выходной</span>}
                </div>
              );
            })}
          </div>
        </div>

        <div className={styles.card}>
          <h2>Праздничные даты</h2>
          <p className={styles.hint}>В эти дни отдел не работает, даже если день недели рабочий.</p>
          {hours.holidays.length > 0 && (
            <div className={styles.holidays}>
              {hours.holidays.map((date) => (
                <span className={styles.holiday} key={date}>
                  {dateLabel(date)}
                  {canEdit && <button type="button" aria-label={`Убрать ${dateLabel(date)}`} onClick={() => { touch(); setHours((current) => ({ ...current, holidays: current.holidays.filter((item) => item !== date) })); }}><X size={12} /></button>}
                </span>
              ))}
            </div>
          )}
          {hours.holidays.length === 0 && <p className={styles.hint}>Праздничных дат пока нет.</p>}
          {canEdit && (
            <div className={styles.addHoliday}>
              <DateField type="date" value={newHoliday} onChange={setNewHoliday} placeholder="Выберите дату" aria-label="Праздничная дата" />
              <button type="button" className={`${settings.cancelButton} ${styles.addButton}`} disabled={!newHoliday} onClick={addHoliday}><Plus size={14} aria-hidden="true" /> Добавить</button>
            </div>
          )}
        </div>

        {canEdit && (
          <div className={styles.actions}>
            <button type="button" className={settings.saveButton} disabled={busy} onClick={() => void save()}>{busy ? "Сохраняем…" : "Сохранить"}</button>
            {error && <span className={settings.inlineError} role="alert">{error}</span>}
            {saved && !error && <span className={styles.saved} role="status">Сохранено</span>}
          </div>
        )}
      </div>
    </section>
  );
}
