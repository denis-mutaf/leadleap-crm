import Link from "next/link";

export default function NotFound() {
  return (
    <main className="module" style={{ minHeight: "var(--vh-shell)", display: "grid", placeItems: "center" }}>
      <div className="empty-state">
        <h1>Запись не найдена</h1>
        <p>Возможно, её уже удалили или у вас нет доступа к этой записи.</p>
        <Link href="/deals" className="btn empty-action">К сделкам</Link>
      </div>
    </main>
  );
}
