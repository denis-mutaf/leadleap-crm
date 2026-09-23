"use client";

import { useRouter } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";

// Строка журнала открывает звонок кликом в любом месте, не только по «Play».
// Ссылки и кнопки внутри строки (сделка, имя) работают как раньше;
// выделение текста мышью звонок не открывает.
export function CallRow({ href, className, style, children }: { href: string; className: string; style?: CSSProperties; children: ReactNode }) {
  const router = useRouter();
  return (
    <tr
      className={className}
      style={style}
      onClick={(event) => {
        if ((event.target as Element).closest("a, button")) return;
        if (window.getSelection()?.toString()) return;
        router.push(href, { scroll: false });
      }}
    >
      {children}
    </tr>
  );
}
