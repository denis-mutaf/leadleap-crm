/* Скелетон отчётов в форме нового экрана: шапка, метрики-модули
   (первая — герой), секция-полосы и две секции-списки. */

export default function Loading() {
  return (
    <div className="reports-page" aria-label="Отчёты загружаются">
      <header className="reports-header">
        <div>
          <span className="sk" style={{ display: "block", width: 120, height: 12 }} />
          <span className="sk" style={{ display: "block", width: 160, height: 26, marginTop: 6 }} />
        </div>
      </header>
      <div className="report-metrics" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div className="report-metric" key={i}>
            <span className="sk" style={{ width: "54%", height: 12 }} />
            <span className="sk" style={{ width: "40%", height: 30, marginTop: 7 }} />
          </div>
        ))}
      </div>
      <div className="report-section" aria-hidden="true">
        <span className="sk" style={{ display: "block", width: 220, height: 16 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              style={{ display: "grid", gridTemplateColumns: "200px minmax(0, 1fr) 60px", gap: 12, alignItems: "center" }}
            >
              <span className="sk" style={{ width: i % 3 ? 140 : 180, height: 12 }} />
              <span className="sk" style={{ width: `${40 + i * 8}%`, height: 20 }} />
              <span className="sk" style={{ width: 40, height: 12, justifySelf: "end" }} />
            </div>
          ))}
        </div>
      </div>
      <div className="report-grid" aria-hidden="true">
        {Array.from({ length: 2 }, (_, s) => (
          <div className="report-section" key={s} style={{ marginBottom: 0 }}>
            <span className="sk" style={{ display: "block", width: 140, height: 16 }} />
            <div style={{ display: "flex", flexDirection: "column", marginTop: 14 }}>
              {Array.from({ length: 4 }, (_, i) => (
                <span key={i} className="sk" style={{ width: i % 2 ? "72%" : "88%", height: 12, margin: "9px 0" }} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
