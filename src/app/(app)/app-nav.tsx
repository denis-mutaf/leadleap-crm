"use client";

import {
  Archive,
  BarChart3,
  CheckSquare,
  Contact,
  Inbox,
  LayoutDashboard,
  Settings,
} from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { setRouteProgress } from "./route-progress";

export type AppNavItem = {
  href: string;
  label: string;
  icon: AppNavIcon;
};

export type AppNavIcon =
  | "deals"
  | "tasks"
  | "inbox"
  | "contacts"
  | "reports"
  | "settings"
  | "trash";

const ICONS = {
  deals: LayoutDashboard,
  tasks: CheckSquare,
  inbox: Inbox,
  contacts: Contact,
  reports: BarChart3,
  settings: Settings,
  trash: Archive,
} satisfies Record<AppNavIcon, typeof LayoutDashboard>;

function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinkContent({
  Icon,
  label,
}: {
  Icon: typeof LayoutDashboard;
  label: string;
}) {
  const { pending } = useLinkStatus();

  // Двухпиксельная чёрточка под пунктом меню терялась: весь экран при этом
  // секунду стоял прежним. Пункт помечается сам и заодно зажигает общую
  // полосу перехода наверху окна.
  useEffect(() => {
    if (!pending) return;
    setRouteProgress(true);
    return () => setRouteProgress(false);
  }, [pending]);

  return (
    <>
      <Icon size={16} />
      {label}
      {pending && <span className="nav-item-pending" aria-hidden="true" />}
    </>
  );
}

export function AppNav({ items }: { items: AppNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Основная навигация">
      {items.map(({ href, label, icon }) => {
        const Icon = ICONS[icon];
        const active = isActivePath(pathname, href);
        return (
          <Link
            className={`nav-item ${active ? "is-active" : ""}`}
            href={href}
            key={href}
            aria-current={active ? "page" : undefined}
            style={{ position: "relative" }}
          >
            <NavLinkContent Icon={Icon} label={label} />
          </Link>
        );
      })}
    </nav>
  );
}
