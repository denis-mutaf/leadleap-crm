"use client";

import { CalendarDays, X } from "lucide-react";
import { Popover } from "radix-ui";
import { useRef, useState } from "react";
import { DayPicker } from "react-day-picker";
import { ru } from "react-day-picker/locale";

// Поле даты в стиле «Фарфор» вместо системного календаря браузера.
// Значение то же, что у нативного поля: "YYYY-MM-DD" или "YYYY-MM-DDTHH:mm",
// поэтому формы и обработчики не меняются. Для GET-форм значение уходит
// скрытым полем с тем же name; autoSubmit отправляет форму после выбора,
// как это делал onChange нативного поля внутри AutoSubmitForm.

type Props = {
  type?: "date" | "datetime-local";
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  autoSubmit?: boolean;
  clearable?: boolean;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** Инлайн-редактор: календарь открыт сразу, закрытие без выбора — onClose. */
  defaultOpen?: boolean;
  onClose?: () => void;
  "aria-label"?: string;
};

const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, step) => String(step * 5).padStart(2, "0"));

function parse(value: string): { date: Date | undefined; time: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value);
  if (!match) return { date: undefined, time: "" };
  const [, y, m, d, hh, mm] = match;
  return { date: new Date(Number(y), Number(m) - 1, Number(d)), time: hh && mm ? `${hh}:${mm}` : "" };
}

function datePart(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Дата собрана из чисел в текущем поясе и в нём же форматируется —
// сервер и браузер показывают одно и то же, гидрация не расходится.
function label(value: string, withTime: boolean): string {
  const { date, time } = parse(value);
  if (!date) return "";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const day = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
  return withTime && time ? `${day}, ${time}` : day;
}

export function DateField({
  type = "date",
  name,
  value,
  defaultValue = "",
  onChange,
  autoSubmit = false,
  clearable = false,
  placeholder = "Дата",
  className,
  disabled,
  defaultOpen = false,
  onClose,
  "aria-label": ariaLabel,
}: Props) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const current = controlled ? value : inner;
  const [open, setOpenState] = useState(defaultOpen);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    if (!next) onClose?.();
  };
  const hidden = useRef<HTMLInputElement>(null);
  const withTime = type === "datetime-local";
  const { date, time } = parse(current);
  const [hour, minute] = (time || "10:00").split(":");

  const commit = (next: string) => {
    if (!controlled) setInner(next);
    onChange?.(next);
    if (autoSubmit) {
      // Скрытое поле обновляется на следующем кадре — отправляем после него.
      requestAnimationFrame(() => hidden.current?.form?.requestSubmit());
    }
  };

  const pickDay = (day: Date | undefined) => {
    if (!day) return;
    if (withTime) {
      commit(`${datePart(day)}T${hour}:${minute}`);
    } else {
      commit(datePart(day));
      setOpen(false);
    }
  };

  const pickTime = (nextHour: string, nextMinute: string) => {
    const base = date ?? new Date();
    commit(`${datePart(base)}T${nextHour}:${nextMinute}`);
  };

  const minuteOptions = MINUTES.includes(minute) ? MINUTES : [...MINUTES, minute].sort();
  const text = label(current, withTime);

  return (
    <span className="date-field-wrap">
      {name ? <input ref={hidden} type="hidden" name={name} value={current} /> : null}
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className={className ? `date-field ${className}` : "date-field"}
            aria-label={ariaLabel ?? placeholder}
            disabled={disabled}
          >
            <CalendarDays size={14} aria-hidden="true" />
            {text ? <span>{text}</span> : <span className="date-field-empty">{placeholder}</span>}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="date-pop" align="start" sideOffset={6} collisionPadding={12}>
            <DayPicker
              mode="single"
              locale={ru}
              weekStartsOn={1}
              showOutsideDays
              selected={date}
              defaultMonth={date}
              onSelect={pickDay}
            />
            {withTime ? (
              <div className="date-pop-time">
                <span>Время</span>
                <select value={hour} onChange={(event) => pickTime(event.target.value, minute)} aria-label="Часы">
                  {HOURS.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                <span>:</span>
                <select value={minute} onChange={(event) => pickTime(hour, event.target.value)} aria-label="Минуты">
                  {minuteOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
            ) : null}
            <div className="date-pop-foot">
              <button type="button" className="btn-ghost" onClick={() => pickDay(new Date())}>Сегодня</button>
              {!withTime ? (
                <button type="button" className="btn-ghost" onClick={() => pickDay(new Date(Date.now() + 86_400_000))}>Завтра</button>
              ) : null}
              {clearable && current && defaultOpen ? (
                <button type="button" className="btn-ghost" onClick={() => { commit(""); setOpen(false); }}>Очистить</button>
              ) : null}
              <span className="header-spacer" />
              {withTime ? (
                <button type="button" className="btn btn-primary" onClick={() => setOpen(false)}>Готово</button>
              ) : null}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {clearable && current && !defaultOpen ? (
        <button type="button" className="date-field-clear" aria-label="Очистить дату" onClick={() => commit("")}>
          <X size={12} aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}
