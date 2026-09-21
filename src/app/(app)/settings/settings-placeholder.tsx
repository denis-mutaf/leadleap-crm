import type { ReactNode } from "react";
import { EmptyState } from "@/components/crm/empty-state";
import styles from "./settings.module.css";

export function SettingsPlaceholder({ title, description, icon }: { title: string; description: string; icon: ReactNode }) {
  return (
    <section className={styles.placeholder}>
      <header className={styles.subhead}>
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </header>
      <div className={styles.placeholderBody}>
        <EmptyState
          icon={icon}
          title="Появится, когда подключим телефонию и мессенджеры"
          description="Раздел пока не подключён к внешним каналам. Здесь появятся настройки, когда интеграции будут готовы."
        />
        <ul className={styles.futureList}>
          <li>Подключение и отключение источников обращений</li>
          <li>Правила распределения входящих обращений</li>
          <li>Рабочие сценарии и уведомления по событиям</li>
        </ul>
      </div>
    </section>
  );
}
