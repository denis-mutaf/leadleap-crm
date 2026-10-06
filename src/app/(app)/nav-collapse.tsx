"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { createContext, useCallback, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import { NAV_COOKIE } from "@/lib/nav-cookie";

// Сайдбар сворачивается до колонки иконок. Выбор живёт в cookie, чтобы
// сервер сразу отдавал нужную ширину и оболочка не прыгала при загрузке.
// В окне уже 1280 px меню сворачивается само: на 1024 и 768 оно занимало
// треть экрана. Это не выбор человека — cookie не трогаем, а при расширении
// окна возвращается то, что он выбрал. Развернуть меню в узком окне можно,
// но только до следующего сужения или перезагрузки.

const NARROW_QUERY = "(max-width: 1279px)";

type NavState = { collapsed: boolean; toggle: () => void };
const NavContext = createContext<NavState>({ collapsed: false, toggle: () => {} });

export function useNavCollapsed() {
  return useContext(NavContext).collapsed;
}

export function NavShell({ initialCollapsed, children }: { initialCollapsed: boolean; children: ReactNode }) {
  const [preferred, setPreferred] = useState(initialCollapsed);
  const [openedNarrow, setOpenedNarrow] = useState(false);
  // Расширенное в узком окне не переживает смену ширины: при каждом переходе
  // через 1280 px меню снова ведёт себя по правилу.
  const subscribe = useCallback((notify: () => void) => {
    const query = window.matchMedia(NARROW_QUERY);
    const onChange = () => {
      setOpenedNarrow(false);
      notify();
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  const narrow = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false,
  );
  const collapsed = narrow ? !openedNarrow : preferred;
  const toggle = () => {
    if (narrow) {
      setOpenedNarrow(!openedNarrow);
      return;
    }
    const next = !preferred;
    setPreferred(next);
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
