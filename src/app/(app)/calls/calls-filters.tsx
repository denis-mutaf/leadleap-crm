"use client";

import type { FormEvent, ReactNode } from "react";

// GET-форма фильтров с авто-submit: любое изменение селекта или чекбокса
// сразу перезагружает список через query string. Живёт здесь, потому что
// page — Server Component, а onChange в нём запрещён.
export function AutoSubmitForm({ children }: { children: ReactNode }) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.currentTarget.requestSubmit();
  };
  return (
    <form method="get" style={{ display: "contents" }} onChange={submit}>
      {children}
    </form>
  );
}
