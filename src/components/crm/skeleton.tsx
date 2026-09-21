import type { ReactNode } from "react";

/** Полоска-заглушка. Ширину задаёт вызывающий: скелетон повторяет форму страницы. */
export function SkLine({
  w = "100%",
  h = 14,
  className = "",
}: {
  w?: number | string;
  h?: number;
  className?: string;
}) {
  return (
    <div
      className={`sk ${className}`}
      style={{ width: typeof w === "number" ? `${w}px` : w, height: h }}
    />
  );
}

export function SkHeader({ children }: { children?: ReactNode }) {
  return (
    <div className="sk-header">
      {children ?? (
        <>
          <SkLine w={16} h={16} />
          <SkLine w={120} h={14} />
        </>
      )}
    </div>
  );
}

export function SkToolbar({ chips = 3 }: { chips?: number }) {
  return (
    <div className="sk-toolbar">
      {Array.from({ length: chips }, (_, index) => (
        <div className="sk sk-chip" key={index} />
      ))}
    </div>
  );
}

/** Таблица: шапка колонок и строки той же высоты, что настоящие. */
export function SkTable({
  rows = 12,
  cols = [170, 160, 110, 180, 140, 180],
}: {
  rows?: number;
  cols?: number[];
}) {
  return (
    <div>
      <div className="sk-row" style={{ height: "var(--h-row-header)" }}>
        {cols.map((width, index) => (
          <SkLine key={index} w={Math.round(width * 0.5)} h={10} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div className="sk-row" key={row}>
          {cols.map((width, index) => (
            <SkLine
              key={index}
              w={Math.round(width * (index === 0 ? 0.8 : 0.6))}
              h={12}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Воронка: колонки и карточки той же геометрии, что живые. */
export function SkBoard({
  columns = 6,
  cards = 3,
}: {
  columns?: number;
  cards?: number;
}) {
  return (
    <div className="sk-board">
      {Array.from({ length: columns }, (_, column) => (
        <div className="sk-col" key={column}>
          <div className="sk-row" style={{ height: "var(--h-row-header)" }}>
            <SkLine w={110} h={12} />
          </div>
          {Array.from({ length: cards }, (_, card) => (
            <div className="sk-card" key={card}>
              <SkLine w="70%" h={14} />
              <SkLine w="45%" h={12} />
              <div style={{ display: "flex", gap: 6 }}>
                <div className="sk sk-chip" style={{ width: 56 }} />
                <div className="sk sk-chip" style={{ width: 44 }} />
              </div>
              <div
                style={{
                  marginTop: "auto",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <div className="sk sk-avatar" />
                <SkLine w={96} h={10} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Карточка записи: левая колонка полей и лента справа. */
export function SkRecord() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "360px minmax(0, 1fr)", flex: 1, minHeight: 0 }}>
      <div style={{ borderRight: "1px solid var(--border)", padding: "16px 12px", display: "flex", flexDirection: "column", gap: 12 }}>
        <SkLine w={180} h={18} />
        <SkLine w={140} h={12} />
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <div className="sk sk-chip" />
          <div className="sk sk-chip" style={{ width: 56 }} />
        </div>
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} style={{ display: "flex", gap: 8 }}>
            <SkLine w={120} h={12} />
            <SkLine w={140} h={12} />
          </div>
        ))}
      </div>
      <div style={{ padding: "16px 12px", display: "flex", flexDirection: "column", gap: 16 }}>
        <SkLine w="100%" h={28} />
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <SkLine w={90} h={10} />
            <SkLine w="72%" h={14} />
            <SkLine w={64} h={10} />
          </div>
        ))}
      </div>
    </div>
  );
}
