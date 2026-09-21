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

  return (
    <>
      <Icon size={16} />
      {label}
      {pending && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            insetInlineStart: 8,
            insetInlineEnd: 8,
            bottom: 0,
            height: 2,
            borderRadius: "var(--radius)",
            background: "var(--primary)",
          }}
        />
      )}
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
