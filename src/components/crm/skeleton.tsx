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
    <div className="sk-board" style={{ flex: 1, minHeight: 0 }}>
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

function SkPage({ children }: { children: ReactNode }) {
  return (
    <div className="sk-page" style={{ minHeight: "var(--vh-shell)" }}>
      {children}
    </div>
  );
}

function SkFilters({ chips = 3 }: { chips?: number }) {
  return (
    <div
      style={{
        height: "var(--h-filters)",
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 var(--px-cell)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {Array.from({ length: chips }, (_, index) => (
        <div className="sk sk-chip" key={index} style={{ width: index === 0 ? 116 : 84 }} />
      ))}
      <div style={{ marginLeft: "auto", display: "flex", gap: 16 }}>
        <SkLine w={92} h={12} />
        <SkLine w={76} h={12} />
      </div>
    </div>
  );
}

function SkRows({ rows = 18, cols = [150, 180, 160, 180, 120] }: { rows?: number; cols?: number[] }) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
      <div className="sk-row" style={{ height: "var(--h-row-header)" }}>
        {cols.map((width, index) => (
          <SkLine key={index} w={Math.round(width * 0.45)} h={10} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div className="sk-row" key={row}>
          {cols.map((width, index) => (
            <SkLine key={index} w={Math.round(width * (index === 0 ? 0.72 : 0.55))} h={12} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Скелетон воронки: шапка, тулбар, фильтры и пять видимых колонок. */
export function SkDealsBoard() {
  return (
    <SkPage>
      <SkHeader />
      <SkToolbar chips={4} />
      <SkFilters chips={2} />
      <SkBoard columns={5} cards={3} />
    </SkPage>
  );
}

/** Скелетон табличного представления сделок. */
export function SkDealsTable() {
  return (
    <SkPage>
      <SkHeader />
      <SkToolbar chips={4} />
      <SkFilters chips={3} />
      <SkRows rows={18} cols={[170, 150, 170, 180, 180, 110]} />
    </SkPage>
  );
}

/** Скелетон списка контактов с плотной таблицей имени и телефона. */
export function SkContacts() {
  return (
    <SkPage>
      <SkHeader />
      <SkToolbar chips={2} />
      <SkRows rows={18} cols={[220, 190, 150, 72]} />
    </SkPage>
  );
}

/** Скелетон двухпанельного inbox: список, thread и контекстная панель. */
export function SkInbox() {
  return (
    <SkPage>
      <SkHeader />
      <div
        style={{
          height: "var(--h-toolbar)",
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 var(--px-cell)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div className="sk sk-chip" style={{ width: 52 }} />
        <div className="sk sk-chip" style={{ width: 68 }} />
        <SkLine w={170} h={28} className="sk-control" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 320px) minmax(0, 1fr) minmax(240px, 280px)", flex: 1, minHeight: 0 }}>
        <div style={{ borderRight: "1px solid var(--border)" }}>
          {Array.from({ length: 11 }, (_, index) => (
            <div key={index} style={{ height: 64, display: "flex", alignItems: "center", gap: 8, padding: "0 var(--px-cell)", borderBottom: "1px solid var(--border)" }}>
              <div className="sk sk-avatar" />
              <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                <SkLine w="64%" h={13} />
                <SkLine w="88%" h={10} />
              </div>
              <SkLine w={34} h={10} />
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ height: "var(--h-toolbar)", flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "0 var(--px-cell)", borderBottom: "1px solid var(--border)" }}>
            <div className="sk sk-avatar" />
            <SkLine w={130} h={14} />
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 16, padding: 20 }}>
            <SkLine w="38%" h={34} />
            <SkLine w="58%" h={34} />
            <SkLine w="44%" h={34} />
          </div>
          <SkLine w="calc(100% - 24px)" h={52} className="sk-composer" />
        </div>
        <div style={{ borderLeft: "1px solid var(--border)", padding: "var(--px-cell)", display: "flex", flexDirection: "column", gap: 10 }}>
          <SkLine w={140} h={16} />
          {Array.from({ length: 7 }, (_, index) => <SkLine key={index} w={index % 2 ? "82%" : "64%"} h={12} />)}
        </div>
      </div>
    </SkPage>
  );
}

/** Скелетон задач с группами просроченных, сегодняшних и будущих строк. */
export function SkTasks() {
  const groups = [2, 6, 4, 3, 2];
  return (
    <SkPage>
      <SkHeader />
      <SkToolbar chips={3} />
      <SkFilters chips={3} />
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: "12px var(--px-cell)" }}>
        {groups.map((rows, group) => (
          <div key={group} style={{ marginBottom: 8 }}>
            <div style={{ height: "var(--h-row)", display: "flex", alignItems: "center", gap: 10, padding: "0 var(--px-cell)", background: "var(--muted)" }}>
              <SkLine w={76} h={12} />
              <SkLine w={18} h={10} />
            </div>
            {Array.from({ length: rows }, (_, row) => (
              <div className="sk-row" key={row}>
                <SkLine w={16} h={16} />
                <SkLine w="28%" h={13} />
                <SkLine w="24%" h={12} />
                <SkLine w="18%" h={12} />
                <SkLine w={54} h={12} />
                <div style={{ marginLeft: "auto" }}><SkLine w={20} h={20} /></div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </SkPage>
  );
}

/** Скелетон отчётов: метрики, график этапов и две табличные секции. */
export function SkReports() {
  return (
    <SkPage>
      <SkHeader />
      <SkToolbar chips={5} />
      <SkFilters chips={3} />
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: "16px var(--px-cell)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginBottom: 20 }}>
          {Array.from({ length: 4 }, (_, index) => <div key={index} style={{ height: 76, border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 12, display: "flex", flexDirection: "column", gap: 12 }}><SkLine w="54%" h={12} /><SkLine w="34%" h={20} /></div>)}
        </div>
        <SkLine w={190} h={16} />
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14, marginBottom: 24 }}>
          {Array.from({ length: 10 }, (_, index) => <div key={index} style={{ display: "grid", gridTemplateColumns: "260px minmax(0, 1fr) 64px", alignItems: "center", gap: 12 }}><SkLine w={index % 3 ? 140 : 180} h={12} /><SkLine w={`${35 + index * 5}%`} h={20} /><SkLine w={40} h={12} /></div>)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}><SkRows rows={5} cols={[220, 90, 90, 90]} /><SkRows rows={5} cols={[220, 90, 90, 90]} /></div>
      </div>
    </SkPage>
  );
}

/** Скелетон настроек с постоянной левой колонкой разделов. */
export function SkSettings({ variant = "stages" }: { variant?: "stages" | "users" | "fields" | "dictionaries" }) {
  const rowCount = variant === "users" ? 7 : variant === "fields" ? 12 : variant === "dictionaries" ? 11 : 14;
  return (
    <SkPage>
      <SkHeader />
      <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr)", flex: 1, minHeight: 0 }}>
        <div style={{ borderRight: "1px solid var(--border)", padding: "var(--px-cell)", display: "flex", flexDirection: "column", gap: 8 }}>
          {Array.from({ length: 12 }, (_, index) => <SkLine key={index} w={index % 4 === 0 ? 62 : 142} h={13} />)}
        </div>
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ height: "var(--h-toolbar)", flex: "none", display: "flex", alignItems: "center", padding: "0 var(--px-cell)", borderBottom: "1px solid var(--border)" }}><SkLine w={170} h={16} /><div style={{ marginLeft: "auto" }}><SkLine w={74} h={28} /></div></div>
          {variant === "dictionaries" && <SkToolbar chips={6} />}
          {variant === "fields" && <SkToolbar chips={2} />}
          <SkRows rows={rowCount} cols={variant === "users" ? [160, 240, 120, 80, 140, 100] : [220, 110, 180, 120, 110]} />
        </div>
      </div>
    </SkPage>
  );
}

/** Скелетон корзины: фильтры и плотная таблица удалённых записей. */
export function SkTrash() {
  return (
    <SkPage>
      <SkHeader />
      <SkToolbar chips={5} />
      <SkRows rows={18} cols={[260, 140, 150, 150, 110, 100]} />
    </SkPage>
  );
}
