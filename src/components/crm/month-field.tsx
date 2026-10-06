"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover } from "radix-ui";
import { useState } from "react";
import { formatMonth, isMonthValue } from "@/lib/deal-input";

// Выбор месяца в нашем поповере вместо <input type="month">: системное окно
// браузера рисуется поверх страницы отдельно, и клик по его сетке мог попасть в
// то, что лежит под ним (в карточке — в ссылку), не выбрав месяц. Здесь сетка —
// обычные кнопки type="button" внутри страницы. Значение то же: "ГГГГ-ММ".

const SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

type Props = {
  value: string;
  onChange: (value: string) => void;
  onClose?: () => void;
  defaultOpen?: boolean;
  "aria-label"?: string;
};

export function MonthField({ value, onChange, onClose, defaultOpen = false, "aria-label": ariaLabel }: Props) {
  const picked = isMonthValue(value) ? value.trim() : "";
  const [open, setOpenState] = useState(defaultOpen);
  const [year, setYear] = useState(() => (picked ? Number(picked.slice(0, 4)) : new Date().getFullYear()));
  const setOpen = (next: boolean) => {
    setOpenState(next);
    if (!next) onClose?.();
  };
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  function pick(next: string) {
    onChange(next);
    setOpen(false);
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="date-field field-input" aria-label={ariaLabel ?? "Месяц"}>
          <CalendarDays size={14} aria-hidden="true" />
          {picked ? <span>{formatMonth(picked)}</span> : <span className="date-field-empty">Месяц</span>}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="date-pop month-pop" align="start" sideOffset={6} collisionPadding={12}>
          <div className="month-pop-head">
            <button type="button" className="month-pop-nav" aria-label="Предыдущий год" onClick={() => setYear(year - 1)}>
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <strong>{year}</strong>
            <button type="button" className="month-pop-nav" aria-label="Следующий год" onClick={() => setYear(year + 1)}>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="month-pop-grid">
            {SHORT.map((name, index) => {
              const month = `${year}-${String(index + 1).padStart(2, "0")}`;
              return (
                <button
                  type="button"
                  key={month}
                  className={`month-pop-cell ${month === picked ? "is-selected" : ""} ${month === thisMonth ? "is-today" : ""}`}
                  aria-pressed={month === picked}
                  onClick={() => pick(month)}
                >
                  {name}
                </button>
              );
            })}
          </div>
          <div className="date-pop-foot">
            <button type="button" className="btn-ghost" onClick={() => pick(thisMonth)}>Этот месяц</button>
            {picked ? <button type="button" className="btn-ghost" onClick={() => pick("")}>Очистить</button> : null}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
