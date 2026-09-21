import Link from "next/link";

export default function NotFound() {
  return (
    <main className="empty-state" style={{ minHeight: "100vh" }}>
      <h1>Запись не найдена</h1>
      <p>Возможно, её уже удалили или у вас нет доступа к этой записи.</p>
      <Link href="/deals">К сделкам</Link>
    </main>
  );
}
