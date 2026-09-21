"use client";

import { ArrowDownUp } from "lucide-react";
import styles from "./contacts.module.css";

export function ContactSortSelect({ value }: { value: "name" | "created" | "activity" }) {
  return (
    <label className={styles.sortControl}>
      <ArrowDownUp size={14} aria-hidden="true" />
      <span>Сортировка</span>
      <select
        name="sort"
        defaultValue={value}
        form="contacts-sort-form"
        aria-label="Сортировка контактов"
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        <option value="activity">По последней активности</option>
        <option value="name">По имени</option>
        <option value="created">По дате добавления</option>
      </select>
    </label>
  );
}
