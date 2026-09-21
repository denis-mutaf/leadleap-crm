"use client";

import { useState } from "react";
import Link from "next/link";
import type { UserRole } from "@/lib/types";
import { USER_ROLE_LABELS } from "@/lib/types";
import styles from "./users.module.css";

type Row = {
  id: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  email: string;
  lastSignIn: string | null;
  dealCount: number;
};
const roles: UserRole[] = ["manager", "head", "admin", "builder"];
function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("ru-RU", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Не входил";
}
function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function UsersClient({
  rows: initialRows,
  currentUserId,
  canEdit,
}: {
  rows: Row[];
  currentUserId: string;
  canEdit: boolean;
}) {
  const [rows, setRows] = useState(initialRows);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({
    email: "",
    full_name: "",
    role: "manager" as UserRole,
  });
  async function update(
    id: string,
    data: Partial<Pick<Row, "role" | "is_active">>,
  ) {
    setBusy(id);
    setError("");
    try {
      const response = await fetch("/api/settings/users", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, ...data }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Не удалось сохранить изменения");
      setRows((items) =>
        items.map((row) => (row.id === id ? { ...row, ...result.user } : row)),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось сохранить изменения",
      );
    } finally {
      setBusy(null);
    }
  }
  async function submitInvite(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy("invite");
    setError("");
    try {
      const response = await fetch("/api/settings/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(invite),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Не удалось отправить приглашение");
      setInviteOpen(false);
      setInvite({ email: "", full_name: "", role: "manager" });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось отправить приглашение",
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <main className={styles.page}>
      <div className={styles.top}>
        <div>
          <Link href="/settings" className={styles.back}>
            ← Настройки
          </Link>
          <p className={styles.eyebrow}>Настройки / Команда</p>
          <h1>Пользователи и роли</h1>
          <p className={styles.subtitle}>
            Людей не удаляют — отключают. История их сделок остаётся.
          </p>
        </div>
        {canEdit && (
          <button
            className={styles.primary}
            onClick={() => setInviteOpen(true)}
          >
            Пригласить
          </button>
        )}
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <section className={styles.card}>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Человек</th>
                <th>Почта</th>
                <th>Роль</th>
                <th>Сделок</th>
                <th>Последний вход</th>
                <th>Состояние</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const self = row.id === currentUserId;
                return (
                  <tr
                    key={row.id}
                    className={!row.is_active ? styles.disabled : ""}
                  >
                    <td>
                      <span className={styles.avatar}>
                        {initials(row.full_name)}
                      </span>
                      <strong>{row.full_name}</strong>
                    </td>
                    <td>{row.email}</td>
                    <td>
                      {canEdit && !self ? (
                        <select
                          aria-label={`Роль ${row.full_name}`}
                          value={row.role}
                          disabled={busy === row.id}
                          onChange={(event) =>
                            update(row.id, {
                              role: event.target.value as UserRole,
                            })
                          }
                        >
                          {roles.map((role) => (
                            <option key={role} value={role}>
                              {USER_ROLE_LABELS[role]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        USER_ROLE_LABELS[row.role]
                      )}
                    </td>
                    <td className={styles.number}>{row.dealCount}</td>
                    <td>{formatDate(row.lastSignIn)}</td>
                    <td>
                      <button
                        className={
                          row.is_active ? styles.status : styles.statusOff
                        }
                        disabled={!canEdit || self || busy === row.id}
                        onClick={() =>
                          update(row.id, { is_active: !row.is_active })
                        }
                      >
                        {row.is_active ? "Активен" : "Отключён"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className={styles.policy}>
        <h2>Доступ и экспорт</h2>
        <p>
          Видимость сделок определяется текущими правилами CRM: руководитель
          видит все сделки, менеджер — в соответствии с политикой команды.
          Отдельного переключателя в схеме нет.
        </p>
        <p>
          Экспорт доступен руководителю и администратору. Настройки видимости и
          экспорта здесь не изменяются.
        </p>
      </section>
      {inviteOpen && (
        <div
          className={styles.overlay}
          role="presentation"
          onKeyDown={(event) => {
            if (event.key === "Escape") setInviteOpen(false);
          }}
        >
          <form className={styles.dialog} onSubmit={submitInvite}>
            <h2>Пригласить пользователя</h2>
            <label>
              Имя
              <input
                required
                value={invite.full_name}
                onChange={(event) =>
                  setInvite({ ...invite, full_name: event.target.value })
                }
              />
            </label>
            <label>
              Почта
              <input
                required
                type="email"
                value={invite.email}
                onChange={(event) =>
                  setInvite({ ...invite, email: event.target.value })
                }
              />
            </label>
            <label>
              Роль
              <select
                value={invite.role}
                onChange={(event) =>
                  setInvite({ ...invite, role: event.target.value as UserRole })
                }
              >
                {roles.map((role) => (
                  <option key={role} value={role}>
                    {USER_ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </label>
            <div className={styles.dialogActions}>
              <button type="button" onClick={() => setInviteOpen(false)}>
                Отмена
              </button>
              <button className={styles.primary} disabled={busy === "invite"}>
                {busy === "invite" ? "Отправка…" : "Отправить приглашение"}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
