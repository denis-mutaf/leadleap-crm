"use client";

import { AlarmClock, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DateField } from "@/components/crm/date-field";
import { dbErrorText } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/client";
import { addDays, addMonth, postponedLabel, todayInDepartment } from "@/lib/postpone-dates";
import styles from "./postpone-control.module.css";

// «Отложить до…»: дата касания, комментарий в ленту, автозадача и автовозврат
// делает база (postpone_crm_deal, create_touch_task, process_postponed_due).
// Сделка остаётся на своём этапе — меняется только статус.

type Props = {
  dealId: string;
  status: string;
  until: string | null;
  onStatusChange: (status: string) => void;
};

export function PostponeControl({ dealId, status, until, onStatusChange }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Серверная дата и локальная живут отдельно: после действия карточка
  // обновляется сразу, а не после router.refresh().
  const [localUntil, setLocalUntil] = useState(until);
  const [syncedUntil, setSyncedUntil] = useState(until);
  if (syncedUntil !== until) { setSyncedUntil(until); setLocalUntil(until); }

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy]);

  const today = todayInDepartment();
  const quick = [
    { label: "Завтра", value: addDays(today, 1) },
    { label: "Через неделю", value: addDays(today, 7) },
    { label: "Через месяц", value: addMonth(today) },
  ];

  function show() {
    setDate(status === "postponed" && localUntil ? localUntil : "");
    setComment("");
    setError(null);
    setOpen(true);
  }

  async function submit() {
    if (busy) return;
    if (!date) { setError("Выберите дату касания"); return; }
    if (date <= today) { setError("Дата касания должна быть в будущем"); return; }
    setBusy(true); setError(null);
    const result = await createClient().rpc("postpone_crm_deal", { p_deal_id: dealId, p_until: date, p_comment: comment.trim() || null });
    setBusy(false);
    if (result.error) { setError(dbErrorText(result.error, "Не удалось отложить сделку. Попробуйте ещё раз.")); return; }
    setLocalUntil(date); onStatusChange("postponed"); setOpen(false);
    toast.success(`Сделка отложена до ${postponedLabel(date)}`);
    router.refresh();
  }

  async function resume() {
    if (busy) return;
    setBusy(true);
    const result = await createClient().rpc("resume_crm_deal", { p_deal_id: dealId });
    setBusy(false);
    if (result.error) { toast.error(dbErrorText(result.error, "Не удалось вернуть сделку в работу. Попробуйте ещё раз.")); return; }
    setLocalUntil(null); onStatusChange("open");
    toast.success("Сделка снова в работе");
    router.refresh();
  }

  if (status !== "open" && status !== "postponed") return null;

  return (
    <>
      {status === "postponed" ? (
        <div className={styles.banner} role="status">
          <AlarmClock size={14} aria-hidden="true" />
          <span className={styles.bannerText}>{localUntil ? `Отложена до ${postponedLabel(localUntil)}` : "Отложена"}</span>
          <button type="button" className={styles.link} onClick={show} disabled={busy}>Изменить</button>
          <button type="button" className="btn" onClick={() => void resume()} disabled={busy}>{busy ? "Возвращаем…" : "Вернуть в работу"}</button>
        </div>
      ) : (
        <div className={styles.row}>
          <button type="button" className="btn" onClick={show}><AlarmClock size={14} aria-hidden="true" /> Отложить</button>
        </div>
      )}
      {open && (
        <div className="gate-scrim motion-veil">
          <div className="gate-dialog motion-dialog" role="dialog" aria-modal="true" aria-label="Отложить сделку">
            <header>
              <div>
                <h2>Отложить до…</h2>
                <p>Сделка останется на своём этапе. В этот день ответственному придёт задача, а сделка вернётся в работу.</p>
              </div>
              <button className="gate-close" type="button" onClick={() => setOpen(false)} aria-label="Закрыть" disabled={busy}><X size={16} /></button>
            </header>
            <div className={styles.quick}>
              {quick.map((item) => (
                <button key={item.label} type="button" className={`${styles.chip} ${date === item.value ? styles.chipOn : ""}`} onClick={() => { setDate(item.value); setError(null); }}>{item.label}</button>
              ))}
            </div>
            <label>Дата касания<DateField disablePast value={date} onChange={(next) => { setDate(next); setError(null); }} aria-label="Дата касания" placeholder="Выберите дату" /></label>
            <label>Комментарий<textarea value={comment} maxLength={2000} onChange={(event) => setComment(event.target.value)} placeholder="Почему откладываем (необязательно)" /></label>
            {error && <p className="gate-error" role="alert">{error}</p>}
            <footer>
              <button className="btn" type="button" onClick={() => setOpen(false)} disabled={busy}>Отмена <kbd>Esc</kbd></button>
              <button className="gate-primary" type="button" onClick={() => void submit()} disabled={busy || !date}>{busy ? "Откладываем…" : "Отложить"}</button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
