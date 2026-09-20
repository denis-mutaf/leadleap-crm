"use client";

import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type AppNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppNav({ items }: { items: AppNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Основная навигация">
      {items.map(({ href, label, icon: Icon }) => {
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
