"use client";

import { useState, type ReactNode } from "react";

// Оболочка карточки сделки для окна уже 1024 px: две колонки (данные и лента)
// не помещаются, поэтому остаётся одна, а переключаются они вкладками. Внутри
// карточки ничего не меняется: оболочка только ставит data-pane, а стили в
// record.module.css прячут лишнюю колонку. На широком экране вкладок нет.
type Pane = "data" | "feed";

const PANES: { key: Pane; label: string }[] = [
  { key: "data", label: "Данные" },
  { key: "feed", label: "Лента" },
];

export function RecordPanes({ children }: { children: ReactNode }) {
  const [pane, setPane] = useState<Pane>("data");
  return (
    <div className="record-panes" data-pane={pane}>
      <div className="record-pane-tabs" role="tablist" aria-label="Раздел карточки">
        {PANES.map((item) => (
          <button
            type="button"
            role="tab"
            key={item.key}
            aria-selected={pane === item.key}
            className={pane === item.key ? "is-active" : ""}
            onClick={() => setPane(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}
