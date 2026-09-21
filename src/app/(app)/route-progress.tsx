"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// Между кликом и новым экраном проходит около секунды: страницы собираются на
// сервере, и React намеренно держит старый экран вместо скелетона. Без внешнего
// знака это читается как «нажал, и ничего не произошло» — ровно та жалоба, с
// которой всё началось. Полоса вверху говорит, что переход идёт.
//
// Полоса общая на всё приложение: у ссылок её включает useLinkStatus, у
// переходов через router.push — startRouteProgress(). Гаснет, когда сменился
// адрес, то есть когда новый экран действительно приехал.

let active = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function setRouteProgress(pending: boolean) {
  const next = Math.max(0, active + (pending ? 1 : -1));
  if (next === active) return;
  active = next;
  emit();
}

export function startRouteProgress() {
  active += 1;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function useRouteProgress() {
  return useSyncExternalStore(
    subscribe,
    () => active > 0,
    () => false,
  );
}

export function RouteProgress() {
  const pending = useRouteProgress();
  const pathname = usePathname();
  const search = useSearchParams();

  useEffect(() => {
    if (active === 0) return;
    active = 0;
    emit();
  }, [pathname, search]);

  return (
    <div
      className={`route-progress ${pending ? "is-pending" : ""}`}
      aria-hidden="true"
    />
  );
}
