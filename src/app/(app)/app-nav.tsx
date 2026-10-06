"use client";

import {
  Archive,
  BarChart3,
  CheckSquare,
  Contact,
  Inbox,
  LayoutDashboard,
  Phone,
  Settings,
} from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, use, useEffect, type MouseEvent } from "react";
import { useNavCollapsed } from "./nav-collapse";
import { readSavedDealsFilters } from "@/lib/deals-filters";
import { setRouteProgress, startRouteProgress } from "./route-progress";

export type AppNavItem = {
  href: string;
  label: string;
  icon: AppNavIcon;
};

export type AppNavIcon =
  | "deals"
  | "tasks"
  | "inbox"
  | "calls"
  | "contacts"
  | "reports"
  | "settings"
  | "trash";

const ICONS = {
  deals: LayoutDashboard,
  tasks: CheckSquare,
  inbox: Inbox,
  calls: Phone,
  contacts: Contact,
  reports: BarChart3,
  settings: Settings,
  trash: Archive,
} satisfies Record<AppNavIcon, typeof LayoutDashboard>;

function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavBadge({
  badges,
  kind,
}: {
  badges: Promise<{ inbox: number; calls: number }>;
  kind: "inbox" | "calls";
}) {
  const { inbox, calls } = use(badges);
  const badge = kind === "inbox" ? inbox : calls;
  if (!badge) return null;
  return (
    <span className="nav-item-badge" aria-label={`${badge} без ответа`}>
      {badge > 99 ? "99+" : badge}
    </span>
  );
}

function NavLinkContent({
  Icon,
  label,
  badges,
  badgeKind,
}: {
  Icon: typeof LayoutDashboard;
  label: string;
  badges?: Promise<{ inbox: number; calls: number }>;
  badgeKind?: "inbox" | "calls";
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
      <span className="nav-label">{label}</span>
      {/* Число неотвеченных видно из любого раздела: иначе про инбокс
          вспоминают, только когда клиент звонит сам. */}
      {badges && badgeKind ? (
        <Suspense fallback={null}>
          <NavBadge badges={badges} kind={badgeKind} />
        </Suspense>
      ) : null}
      {pending && <span className="nav-item-pending" aria-hidden="true" />}
    </>
  );
}

export function AppNav({
  items,
  badges,
}: {
  items: AppNavItem[];
  badges: Promise<{ inbox: number; calls: number }>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const collapsed = useNavCollapsed();

  // Пункт «Сделки» ведёт в воронку с теми фильтрами, с которыми из неё вышли.
  // Адрес без параметров кэшируется роутером на минуту, поэтому подставляем
  // сохранённые фильтры сами, а не ждём редиректа сервера.
  const openDeals = (event: MouseEvent<HTMLAnchorElement>) => {
    if (pathname === "/deals" || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const saved = readSavedDealsFilters();
    if (!saved) return;
    event.preventDefault();
    startRouteProgress();
    router.push(`/deals?${saved}`);
  };

  return (
    <nav aria-label="Основная навигация">
      {items.map(({ href, label, icon }) => {
        const Icon = ICONS[icon];
        const active = isActivePath(pathname, href);
        const badgeKind =
          href === "/inbox" ? ("inbox" as const) : href === "/calls" ? ("calls" as const) : undefined;
        return (
          <Link
            className={`nav-item ${active ? "is-active" : ""}`}
            href={href}
            key={href}
            // Восемь пунктов меню на каждой загрузке гнали пачку ?_rsc-запросов
            // через прокси и раскладку; пачка периодически отдавала 503.
            // Без prefetch в области видимости пункты не грузятся разом.
            prefetch={false}
            aria-current={active ? "page" : undefined}
            title={collapsed ? label : undefined}
            onClick={href === "/deals" ? openDeals : undefined}
            style={{ position: "relative" }}
          >
            <NavLinkContent
              Icon={Icon}
              label={label}
              badges={badges}
              badgeKind={badgeKind}
            />
          </Link>
        );
      })}
    </nav>
  );
}
