"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { createContext, useContext, useState, type ReactNode } from "react";
import { NAV_COOKIE } from "@/lib/nav-cookie";

// Сайдбар сворачивается до колонки иконок. Выбор живёт в cookie, чтобы
// сервер сразу отдавал нужную ширину и оболочка не прыгала при загрузке.

type NavState = { collapsed: boolean; toggle: () => void };
const NavContext = createContext<NavState>({ collapsed: false, toggle: () => {} });

export function useNavCollapsed() {
  return useContext(NavContext).collapsed;
}

export function NavShell({ initialCollapsed, children }: { initialCollapsed: boolean; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${NAV_COOKIE}=${next ? "collapsed" : "open"}; path=/; max-age=31536000; samesite=lax`;
  };
  return (
    <NavContext.Provider value={{ collapsed, toggle }}>
      <div className="app-shell" data-nav={collapsed ? "collapsed" : "open"}>
        {children}
      </div>
    </NavContext.Provider>
  );
}

export function NavToggle() {
  const { collapsed, toggle } = useContext(NavContext);
  const label = collapsed ? "Развернуть меню" : "Свернуть меню";
  return (
    <button type="button" className="nav-toggle" onClick={toggle} aria-label={label} aria-expanded={!collapsed} title={label}>
      {collapsed ? <PanelLeftOpen size={16} aria-hidden="true" /> : <PanelLeftClose size={16} aria-hidden="true" />}
    </button>
  );
}
