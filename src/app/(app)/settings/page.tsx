import { Info } from "lucide-react";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Stage } from "@/lib/types";
import styles from "./settings.module.css";
import { StageTable } from "./stage-settings-table";

export default async function SettingsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role === "manager") redirect("/deals");
  if (profile.role === "builder") redirect("/reports");
  const supabase = await createClient();
  const result = await supabase.from("stages").select("id, name, position, kind, requires_next_step, requires_qualification_tag, requires_qualification, is_active, created_at").order("position");
  if (result.error) throw new Error(`Этапы: ${result.error.message}`);
  const snapshot = await supabase.rpc("crm_report_snapshot");
  if (snapshot.error) throw new Error(`Счётчики этапов: ${snapshot.error.message}`);
  // В настройках считаются все сделки этапа, включая успешные и отказы:
  // рядом стоит запрет удалять этап со сделками. stage_counts — это живая
  // воронка для отчёта, там «Договор» и «Отказ» законно нулевые.
  const payload = snapshot.data as { stage_totals?: Record<string, number> } | null;
  const counts = payload?.stage_totals ?? {};
  const rows = ((result.data ?? []) as Stage[]).map((stage) => ({ ...stage, counts: { total: Number(counts[stage.id] ?? 0) } }));
  return <div className={`${styles.page} settings-content`}>
    <header className={styles.header}><div><h1>Воронка и этапы</h1><p className={styles.subtitle}>Порядок меняется перетаскиванием. Этапы видят все менеджеры</p></div></header>
    <div className={styles.tableWrap}><StageTable rows={rows} canEdit={profile.role === "admin"} /></div>
    <aside className={styles.note}><Info size={16} aria-hidden="true" /><p>Этап со сделками удалить нельзя — сначала переведите их. История переходов сохраняется даже по удалённым этапам.</p></aside>
  </div>;
}
