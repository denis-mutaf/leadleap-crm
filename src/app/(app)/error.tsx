"use client";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="empty-state" role="alert" style={{ minHeight: "var(--vh-shell)" }}>
      <h1>Не удалось загрузить экран</h1>
      <p>Данные временно недоступны. Попробуйте обновить страницу.</p>
      <button type="button" onClick={reset}>
        Обновить
      </button>
    </main>
  );
}
