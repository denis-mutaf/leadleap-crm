import { SkHeader, SkLine, SkRecord } from "@/components/crm/skeleton";

/* Скелетон повторяет форму карточки контакта: шапка, тулбар, две колонки. */
export default function Loading() {
  return (
    <div className="sk-page" style={{ minHeight: "var(--vh-shell)" }}>
      <SkHeader />
      <div className="sk-toolbar">
        <div className="sk sk-chip" style={{ width: 120 }} />
        <div className="sk sk-chip" style={{ width: 90 }} />
        <div className="sk sk-chip" style={{ width: 90 }} />
      </div>
      <div style={{ padding: "0 12px" }}>
        <SkLine w={200} h={12} />
      </div>
      <SkRecord />
    </div>
  );
}
