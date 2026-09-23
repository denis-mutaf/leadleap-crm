import { SkHeader, SkRecord } from "@/components/crm/skeleton";

export default function Loading() {
  return (
    <div className="sk-page" style={{ minHeight: "var(--vh-shell)" }}>
      <SkHeader />
      <SkRecord />
    </div>
  );
}
