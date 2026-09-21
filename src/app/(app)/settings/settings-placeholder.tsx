import type { ReactNode } from "react";
import { EmptyState } from "@/components/crm/empty-state";
import styles from "./settings.module.css";

// Три раздела показывали одну и ту же заглушку про мессенджеры, включая
// «Рабочие часы», которые к мессенджерам отношения не имеют. Каждый раздел
// говорит своё: чего именно тут ещё нет и от чего это зависит.
export function SettingsPlaceholder({
  title,
  description,
  icon,
  waitingFor,
  items,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  waitingFor: string;
  items: string[];
}) {
  return (
    <section className={styles.placeholder}>
      <header className={styles.subhead}>
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </header>
      <div className={styles.placeholderBody}>
        <EmptyState icon={icon} title={waitingFor} description="Раздел ещё не собран. Здесь появятся настройки, когда дойдёт очередь." />
        <div className={styles.futureList}>
          <p>Что здесь появится</p>
          <ul>
            {items.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      </div>
    </section>
  );
}
