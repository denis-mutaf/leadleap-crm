"use client";

import { useEffect } from "react";

// Системная подсказка браузера (атрибут title) — серый прямоугольник ОС.
// Слой перехватывает наведение на любой элемент с title, прячет системную
// подсказку и показывает свою в стиле «Фарфор». Разметку экранов менять не
// нужно: title остаётся источником текста. Текст переносится в data-tip при
// первом наведении, а aria-label ставится, если его не было, — подпись для
// скринридера не теряется.

const DELAY = 380;
const GAP = 8;

export function TooltipLayer() {
  useEffect(() => {
    let tip: HTMLDivElement | null = null;
    let current: Element | null = null;
    let timer: number | undefined;

    const hide = () => {
      window.clearTimeout(timer);
      current = null;
      tip?.remove();
      tip = null;
    };

    const show = (el: Element) => {
      const text = el.getAttribute("data-tip");
      if (!text || !el.isConnected) return;
      tip?.remove();
      tip = document.createElement("div");
      tip.className = "tooltip-layer";
      tip.setAttribute("role", "tooltip");
      tip.textContent = text;
      document.body.appendChild(tip);
      const box = el.getBoundingClientRect();
      const own = tip.getBoundingClientRect();
      const above = box.top - own.height - GAP;
      const top = above > 8 ? above : box.bottom + GAP;
      const left = Math.min(
        Math.max(8, box.left + box.width / 2 - own.width / 2),
        window.innerWidth - own.width - 8,
      );
      tip.style.top = `${Math.round(top)}px`;
      tip.style.left = `${Math.round(left)}px`;
    };

    const over = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const target = event.target instanceof Element ? event.target.closest("[title], [data-tip]") : null;
      if (!target || target === current) return;
      const title = target.getAttribute("title");
      if (title) {
        target.setAttribute("data-tip", title);
        target.removeAttribute("title");
        if (!target.hasAttribute("aria-label") && !target.textContent?.trim()) {
          target.setAttribute("aria-label", title);
        }
      }
      hide();
      current = target;
      timer = window.setTimeout(() => current === target && show(target), DELAY);
    };

    const out = (event: PointerEvent) => {
      if (!current) return;
      const next = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (next && current.contains(next)) return;
      hide();
    };

    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    window.addEventListener("scroll", hide, true);
    return () => {
      hide();
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      window.removeEventListener("scroll", hide, true);
    };
  }, []);

  return null;
}
