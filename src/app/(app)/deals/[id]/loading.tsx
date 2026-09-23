import { SkHeader, SkLine, SkRecord } from "@/components/crm/skeleton";

/* Скелетон повторяет форму карточки: шапка, ряд плашек-плиток, две колонки. */
export default function Loading() {
  return (
    <div className="sk-page" style={{ minHeight: "var(--vh-shell)" }}>
      <SkHeader />
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.1fr .75fr .75fr", gap: 12, padding: "0 12px 12px" }}>
        {[160, 130, 90, 90].map((width) => (
          <div key={width} className="tile" style={{ height: 64, padding: "8px 12px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 8 }}>
            <SkLine w={width * 0.5} h={10} />
            <SkLine w={width * 0.7} h={12} />
          </div>
        ))}
      </div>
      <SkRecord />
    </div>
  );
}
