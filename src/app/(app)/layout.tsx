import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { USER_ROLE_LABELS } from "@/lib/types";
import { SignOutButton } from "./sign-out-button";
import { AppNav, type AppNavItem } from "./app-nav";
import { GlobalSearch } from "./global-search";
import { NotificationsPanel } from "./notifications-panel";
import { IncomingCallOverlay } from "./incoming-call-overlay";

type NavEntry = AppNavItem & {
  roles: string[];
};

const NAV: NavEntry[] = [
  {
    href: "/deals",
    label: "Сделки",
    icon: "deals",
    roles: ["manager", "head", "admin"],
  },
  {
    href: "/tasks",
    label: "Задачи",
    icon: "tasks",
    roles: ["manager", "head", "admin"],
  },
  {
    href: "/inbox",
    label: "Инбокс",
    icon: "inbox",
    roles: ["manager", "head", "admin"],
  },
  {
    href: "/contacts",
    label: "Контакты",
    icon: "contacts",
    roles: ["manager", "head", "admin"],
  },
  {
    href: "/reports",
    label: "Отчёты",
    icon: "reports",
    roles: ["head", "admin", "builder"],
  },
  {
    href: "/settings",
    label: "Настройки",
    icon: "settings",
    roles: ["head", "admin"],
  },
];

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const visibleNav = NAV.filter((item) =>
    item.roles.includes(profile.role),
  ).map((item) =>
    profile.role === "builder" && item.href === "/reports"
      ? { ...item, label: "Дашборд" }
      : item,
  );

  return (
    <div className="app-shell">
      <aside className="nav">
        <div className="nav-brand">ISRAGRUP</div>
        {profile.role !== "builder" && <GlobalSearch />}
        <AppNav items={visibleNav} />
        <div className="nav-foot">
          <span className="avatar">
            {profile.full_name.slice(0, 2).toUpperCase()}
          </span>
          <span className="nav-person">
            <strong>{profile.full_name}</strong>
            <small>{USER_ROLE_LABELS[profile.role]}</small>
          </span>
          <SignOutButton />
        </div>
      </aside>
      <main className="main-shell">
        <NotificationsPanel role={profile.role} />
        <IncomingCallOverlay role={profile.role} />
        {children}
      </main>
    </div>
  );
}
