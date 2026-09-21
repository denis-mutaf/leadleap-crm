import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import FieldsClient, { type FieldRow } from "./fields-client";

export default async function FieldsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!["admin", "head"].includes(profile.role)) redirect("/settings");
  const supabase = await createClient();
  const [defs, deals, contacts] = await Promise.all([
    supabase
      .from("custom_field_defs")
      .select("*")
      .order("position")
      .order("created_at"),
    supabase.from("deals").select("id", { count: "exact", head: true }),
    supabase.from("contacts").select("id", { count: "exact", head: true }),
  ]);
  if (defs.error) throw new Error(`Поля: ${defs.error.message}`);
  if (deals.error) throw new Error(`Сделки: ${deals.error.message}`);
  if (contacts.error) throw new Error(`Контакты: ${contacts.error.message}`);
  const rows: FieldRow[] = [];
  for (const field of defs.data ?? []) {
    const total = field.entity === "contact" ? contacts.count : deals.count;
    if (total === null)
      throw new Error("Не удалось определить точное количество записей");
    const filled = await supabase
      .from("custom_field_values")
      .select("entity_id", { count: "exact", head: true })
      .eq("field_id", field.id)
      .not("value", "is", null);
    if (filled.error) throw new Error(`Заполненность: ${filled.error.message}`);
    if (filled.count === null)
      throw new Error(
        "Не удалось определить точное количество заполненных значений",
      );
    rows.push({ ...field, total, filled: filled.count });
  }
  return (
    <FieldsClient
      initialRows={rows}
      canEdit={profile.role === "admin"}
      totals={{ deal: deals.count ?? 0, contact: contacts.count ?? 0 }}
    />
  );
}
