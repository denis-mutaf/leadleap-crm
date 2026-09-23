import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { USER_ROLE_LABELS } from "@/lib/types";
import { SignOutButton } from "./sign-out-button";
import { AppNav, type AppNavItem } from "./app-nav";
import { GlobalSearch } from "./global-search";
import { NotificationsPanel } from "./notifications-panel";
import { IncomingCallOverlay } from "./incoming-call-overlay";
import { Toaster } from "@/components/ui/sonner";
import { Suspense } from "react";
import { RouteProgress } from "./route-progress";

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
    href: "/calls",
    label: "Звонки",
    icon: "calls",
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
  {
    href: "/trash",
    label: "Корзина",
    icon: "trash",
    roles: ["manager", "head", "admin"],
  },
];

async function loadNavBadges(profile: {
  role: string;
}): Promise<{ inbox: number; calls: number }> {
  if (profile.role === "builder") {
    return { inbox: 0, calls: 0 };
  }
  const supabase = await createClient();
  const [conversations, calls] = await Promise.all([
    supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("last_direction", "in"),
    // Пропущенные без обратного звонка — счётчик пункта «Звонки».
    supabase
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("direction", "in")
      .or("duration_sec.is.null,duration_sec.eq.0")
      .is("called_back_at", null),
  ]);
  return {
    inbox: conversations.count ?? 0,
    calls: calls.count ?? 0,
  };
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  // Диалоги, где последним написал клиент. Счёт идёт под RLS, поэтому
  // менеджер видит только то, что ему и так доступно.
  const badges = loadNavBadges(profile);

  const visibleNav = NAV.filter((item) =>
    item.roles.includes(profile.role),
  ).map((item) =>
    profile.role === "builder" && item.href === "/reports"
      ? { ...item, label: "Дашборд" }
      : item,
  );

  return (
    <div className="app-shell">
      <Suspense fallback={null}>
        <RouteProgress />
      </Suspense>
      <aside className="nav">
        <div className="nav-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo.svg" alt="ISRAGRUP" />
        </div>
        {profile.role !== "builder" && <GlobalSearch />}
        <AppNav items={visibleNav} badges={badges} />
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
        <IncomingCallOverlay role={profile.role} actorId={profile.id} />
        {children}
      </main>
      <Toaster position="bottom-right" />
    </div>
  );
}
