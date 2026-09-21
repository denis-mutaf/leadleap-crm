import { Info } from "lucide-react";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Stage } from "@/lib/types";
import styles from "./settings.module.css";
import { StageTable } from "./stage-settings-table";
import Link from "next/link";

async function countDeals(
  supabase: Awaited<ReturnType<typeof createClient>>,
  stageId: string,
) {
  const result = await supabase
    .from("deals")
    .select("id", { count: "exact", head: true })
    .eq("stage_id", stageId);
  if (result.error) throw new Error(`Сделки: ${result.error.message}`);
  return result.count ?? 0;
}

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
) {
  const results: R[] = [];
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

export default async function SettingsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role === "manager") redirect("/deals");
  if (profile.role === "builder") redirect("/reports");

  const supabase = await createClient();
  const result = await supabase
    .from("stages")
    .select(
      "id, name, position, kind, requires_next_step, requires_qualification_tag, requires_qualification, is_active, created_at",
    )
    .order("position");
  if (result.error) throw new Error(`Этапы: ${result.error.message}`);

  const stages = (result.data ?? []) as Stage[];
  const rows = await mapWithLimit(stages, 4, async (stage) => ({
    ...stage,
    counts: { total: await countDeals(supabase, stage.id) },
  }));
  const active = rows.filter((stage) => stage.is_active);
  const historical = rows.filter(
    (stage) => !stage.is_active && stage.counts.total > 0,
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Настройки</p>
          <h1>Воронка и этапы</h1>
          <p className={styles.subtitle}>
            {profile.role === "admin"
              ? "Правила доступны для просмотра и изменения."
              : "Правила доступны для просмотра."}
          </p>
        </div>
        <span className={styles.role}>
          {profile.role === "admin" ? "Администратор" : "Руководитель"}
        </span>
      </header>

      <section className={styles.card} aria-labelledby="active-stages">
        <div className={styles.cardHeader}>
          <div>
            <h2 id="active-stages">Активные этапы</h2>
            <p>
              Все этапы живой воронки в текущем порядке. Сделки считаются из
              базы с учётом RLS.
            </p>
          </div>
          <span className={styles.readOnly}>
            {profile.role === "admin" ? "Администратор" : "Только чтение"}
          </span>
        </div>
        <div className={styles.tableWrap}>
          <StageTable rows={active} canEdit={profile.role === "admin"} />
        </div>
      </section>

      {historical.length > 0 && (
        <section
          className={`${styles.card} ${styles.historical}`}
          aria-labelledby="historical-stages"
        >
          <div className={styles.cardHeader}>
            <div>
              <h2 id="historical-stages">Исторические этапы</h2>
              <p>
                Неактивные этапы показаны, потому что в них ещё есть сделки. Они
                не участвуют в новых переходах.
              </p>
            </div>
          </div>
          <div className={styles.tableWrap}>
            <StageTable rows={historical} canEdit={profile.role === "admin"} />
          </div>
        </section>
      )}

      <aside className={styles.note}>
        <Info size={16} aria-hidden="true" />
        <p>
          <strong>Важно.</strong> Этап со сделками удалить нельзя — сначала
          переведите сделки на другой этап. История переходов сохраняется.
        </p>
      </aside>

      <Link className={styles.usersLink} href="/settings/users">
        Управление пользователями и ролями <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}
