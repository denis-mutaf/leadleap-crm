import { Settings } from "lucide-react";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { SettingsNav } from "./settings-nav";
import styles from "./settings.module.css";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role === "manager") redirect("/deals");
  if (profile.role === "builder") redirect("/reports");

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <Settings size={16} aria-hidden="true" />
        <span>Настройки</span>
      </header>
      <div className={styles.workspace}>
        <SettingsNav />
        <main className={styles.pane}>{children}</main>
      </div>
    </div>
  );
}
