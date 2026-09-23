/* Скелетон «Звонков» в форме нового экрана: шапка, сегменты-пилюли,
   таблица-модуль с плиткой и панель-модуль звонка. */

export default function Loading() {
  return (
    <section
      aria-label="Звонки загружаются"
      style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
    >
      <div className="sk-header">
        <span className="sk" style={{ width: 180, height: 20 }} />
        <span className="sk" style={{ width: 64, height: 14, marginLeft: "auto" }} />
      </div>
      <div className="sk-toolbar">
        <span className="sk sk-chip" style={{ width: 52 }} />
        <span className="sk sk-chip" style={{ width: 120 }} />
        <span className="sk sk-chip" style={{ width: 96 }} />
        <span className="sk sk-chip" style={{ width: 64 }} />
        <span className="sk" style={{ width: 220, height: 30, borderRadius: 999, marginLeft: "auto" }} />
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 380px",
          gap: "var(--gap-module)",
          padding: "0 var(--px-cell) var(--px-cell)",
        }}
      >
        <div className="module" style={{ padding: 6, display: "flex", flexDirection: "column" }}>
          <div className="tile" style={{ overflow: "hidden", flex: 1 }}>
            {Array.from({ length: 12 }, (_, i) => (
              <div
                key={i}
                className="sk-row"
                style={{ borderBottom: "1px solid var(--border)" }}
              >
                <span className="sk" style={{ width: 24, height: 24, borderRadius: "50%" }} />
                <span className="sk sk-avatar" />
                <span className="sk" style={{ width: i % 3 ? "22%" : "14%", height: 13 }} />
                <span className="sk" style={{ width: "12%", height: 12 }} />
                <span className="sk sk-chip" style={{ width: 88 }} />
                <span className="sk" style={{ width: 64, height: 12, marginLeft: "auto" }} />
              </div>
            ))}
          </div>
        </div>
        <div className="module" style={{ padding: 6, display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="tile" style={{ padding: 12, display: "flex", alignItems: "center", gap: 12 }}>
            <span className="sk" style={{ width: 32, height: 32, borderRadius: "50%" }} />
            <span className="sk" style={{ flex: 1, height: 4, borderRadius: 2 }} />
          </div>
          <div className="tile" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
            <span className="sk sk-chip" style={{ width: 180 }} />
            {Array.from({ length: 5 }, (_, i) => (
              <span key={i} className="sk" style={{ width: i % 2 ? "82%" : "64%", height: 12 }} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
