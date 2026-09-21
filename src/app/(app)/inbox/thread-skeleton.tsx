import { SkLine } from "@/components/crm/skeleton";

// Заглушка повторяет геометрию живой переписки: шапка, пузыри по двум
// сторонам, поле ответа внизу. Так при переключении диалога ничего не
// прыгает — меняется только содержимое.
const BUBBLES: { width: string; height: number; out: boolean }[] = [
  { width: "46%", height: 38, out: false },
  { width: "62%", height: 56, out: true },
  { width: "38%", height: 38, out: false },
  { width: "54%", height: 38, out: true },
  { width: "48%", height: 56, out: false },
];

export function ThreadSkeleton() {
  return (
    <>
      <main className="inbox-thread">
        <header className="inbox-thread-header">
          <div className="sk sk-avatar" style={{ width: 26, height: 26 }} />
          <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 6 }}>
            <SkLine w={140} h={13} />
            <SkLine w={80} h={10} />
          </div>
        </header>
        <div className="inbox-messages">
          {BUBBLES.map((bubble, index) => (
            <div
              key={index}
              className="sk"
              style={{
                width: bubble.width,
                height: bubble.height,
                margin: bubble.out ? "0 0 12px auto" : "0 0 12px",
              }}
            />
          ))}
        </div>
        <div className="inbox-composer">
          <div className="sk" style={{ height: 56 }} />
        </div>
      </main>
      <aside className="inbox-context" aria-hidden="true">
        <h2>Контекст</h2>
        <div style={{ display: "grid", gap: 10 }}>
          <SkLine w="70%" h={13} />
          <SkLine w="45%" h={11} />
        </div>
      </aside>
    </>
  );
}
