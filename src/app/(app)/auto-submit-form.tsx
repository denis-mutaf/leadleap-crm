"use client";

import Form from "next/form";
import type { FormEvent, ReactNode } from "react";

// GET-форма фильтров с авто-submit: любое изменение селекта или чекбокса
// сразу перезагружает список через query string. Клиентский компонент живёт
// отдельно, потому что страницы — Server Components, а onChange в них запрещён.
export function AutoSubmitForm({ children, action, className }: { children: ReactNode; action: string; className?: string }) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.currentTarget.requestSubmit();
  };
  return (
    <Form action={action} className={className} style={className ? undefined : { display: "contents" }} onChange={submit}>
      {children}
    </Form>
  );
}
