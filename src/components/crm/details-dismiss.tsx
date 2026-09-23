"use client";

import { useEffect } from "react";

// Меню на <details> (фильтр и сортировка доски) браузер сам не закрывает:
// клик мимо и Esc закрывают все раскрытые, как у остальных поповеров.
// Выбор пункта-ссылки тоже закрывает меню: страница остаётся та же.
export function DetailsDismiss() {
  useEffect(() => {
    const closeAll = (keep?: Node) => {
      document.querySelectorAll<HTMLDetailsElement>("details[open]").forEach((details) => {
        if (!keep || !details.contains(keep)) details.open = false;
      });
    };
    const onPointerDown = (event: PointerEvent) => closeAll(event.target as Node);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAll();
    };
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.("details[open] a");
      if (link) link.closest("details")?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("click", onClick);
    };
  }, []);
  return null;
}
