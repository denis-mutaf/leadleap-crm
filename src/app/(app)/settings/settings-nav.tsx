"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./settings.module.css";

const groups = [
  {
    label: "Продажи",
    items: [
      ["/settings", "Воронка и этапы"],
      ["/settings/projects", "Площадки"],
      ["/settings/fields", "Поля карточки"],
      ["/settings/tags", "Метки"],
      ["/settings/dictionaries", "Справочники"],
    ],
  },
  {
    label: "Люди",
    items: [
      ["/settings/users", "Пользователи и роли"],
      ["/settings/working-hours", "Рабочие часы"],
    ],
  },
  {
    label: "Система",
    items: [
      ["/settings/channels", "Каналы"],
      ["/settings/notifications", "Уведомления"],
      ["/settings/audit", "Журнал изменений"],
    ],
  },
] as const;

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav className={styles.sections} aria-label="Разделы настроек">
      {groups.map((group) => (
        <div className={`${styles.group} motion-list`} key={group.label}>
          <p>{group.label}</p>
          {group.items.map(([href, label], i) => {
            const active = href === "/settings" ? pathname === href : pathname.startsWith(href);
            return (
              <Link className={active ? styles.isActive : undefined} style={{ "--i": i } as React.CSSProperties} href={href} key={href} aria-current={active ? "page" : undefined}>
                {label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
