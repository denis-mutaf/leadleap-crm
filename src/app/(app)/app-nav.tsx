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
import Link from "next/link";
import { usePathname } from "next/navigation";

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
          >
            <Icon size={16} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
