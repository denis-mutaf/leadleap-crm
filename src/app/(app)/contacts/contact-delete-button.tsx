"use client";

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import styles from "./contacts.module.css";

export default function ContactDeleteButton({
  contactId,
}: {
  contactId: string;
}) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const actionRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const pendingRef = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (pendingRef.current) return;
    setMenuOpen(false);
    setConfirmOpen(false);
    setError(null);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  };

  useEffect(() => {
    if (!menuOpen && !confirmOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (confirmOpen) close();
        else setMenuOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not(:disabled)",
        ),
      ];
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) {
        event.preventDefault();
        focusable.at(-1)?.focus();
      } else if (
        !event.shiftKey &&
        document.activeElement === focusable.at(-1)
      ) {
        event.preventDefault();
        focusable[0].focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirmOpen, menuOpen]);

  useEffect(() => {
    if (!confirmOpen) return;
    window.setTimeout(() => {
      dialogRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    }, 0);
  }, [confirmOpen]);

  useEffect(() => {
    if (!menuOpen || confirmOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!actionRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [confirmOpen, menuOpen]);

  async function submit() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const response = await createClient().rpc("soft_delete_crm_record", {
        p_entity: "contacts",
        p_id: contactId,
      });
      if (response.error) throw new Error(response.error.message);
      router.push("/contacts");
      router.refresh();
    } catch (caught) {
      pendingRef.current = false;
      setSubmitting(false);
      const code =
        typeof caught === "object" && caught && "code" in caught
          ? String(caught.code)
          : "";
      const message = caught instanceof Error ? caught.message : "";
      setError(
        code === "42501" || /active|deal|сделк|permission|прав/i.test(message)
          ? "Контакт нельзя удалить: есть активная сделка или недостаточно прав."
          : "Не удалось удалить контакт. Попробуйте ещё раз.",
      );
    }
  }

  return (
    <div ref={actionRef} className={styles.deleteActions}>
      <button
        ref={triggerRef}
        className={styles.deleteMenuButton}
        type="button"
        aria-label="Действия контакта"
        onClick={() => setMenuOpen((value) => !value)}
      >
        <MoreHorizontal size={16} />
      </button>
      {menuOpen && !confirmOpen && (
        <div className={styles.deletePopover} role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setConfirmOpen(true);
              setError(null);
            }}
          >
            Удалить контакт
          </button>
        </div>
      )}
      {confirmOpen && (
        <div
          className={styles.mergeScrim}
          role="presentation"
          onMouseDown={(event) =>
            event.target === event.currentTarget &&
            !pendingRef.current &&
            close()
          }
        >
          <section
            ref={dialogRef}
            className={styles.deleteModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-contact-title"
          >
            <header className={styles.mergeHeader}>
              <h2 id="delete-contact-title">Удалить контакт?</h2>
              <button
                type="button"
                aria-label="Закрыть"
                onClick={close}
                disabled={submitting}
              >
                <X size={16} />
              </button>
            </header>
            <div className={styles.deleteBody}>
              <p>
                Контакт и его телефоны будут скрыты из рабочих списков.
                Связанные данные сохранятся для восстановления.
              </p>
              <p className={styles.mergeHint}>
                Если у контакта есть активная сделка, операция будет отклонена.
                Восстановление доступно в течение 30 дней.
              </p>
              {error && <p className={styles.mergeError}>{error}</p>}
            </div>
            <footer className={styles.mergeFooter}>
              <button type="button" onClick={close} disabled={submitting}>
                Отмена <span className={styles.kbd}>ESC</span>
              </button>
              <button
                type="button"
                className={styles.deleteConfirm}
                onClick={() => void submit()}
                disabled={submitting}
              >
                {submitting ? "Удаление…" : "Удалить"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
