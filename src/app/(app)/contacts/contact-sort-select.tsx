"use client";

import { ArrowDownUp } from "lucide-react";
import styles from "./contacts.module.css";

export function ContactSortSelect({ value, q }: { value: "name" | "created" | "activity"; q: string }) {
  return (
    <form className={styles.sortForm} role="search" aria-label="Сортировка контактов">
      <input type="hidden" name="q" value={q} />
      <label className={styles.sortControl}>
        <ArrowDownUp size={14} aria-hidden="true" />
        <span>Сортировка</span>
        <select
          name="sort"
          defaultValue={value}
          aria-label="Сортировка контактов"
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
        >
          <option value="activity">По последней активности</option>
          <option value="name">По имени</option>
          <option value="created">По дате добавления</option>
        </select>
      </label>
    </form>
  );
}
