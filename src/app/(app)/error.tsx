"use client";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="module" role="alert" style={{ minHeight: "var(--vh-shell)", display: "grid", placeItems: "center" }}>
      <div className="empty-state">
        <h1>Не удалось загрузить экран</h1>
        <p>Данные временно недоступны. Попробуйте обновить страницу.</p>
        <button type="button" className="btn empty-action" onClick={reset}>
          Обновить
        </button>
      </div>
    </main>
  );
}
