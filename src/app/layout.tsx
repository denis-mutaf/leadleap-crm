import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Doto, Inter_Tight, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { DetailsDismiss } from "@/components/crm/details-dismiss";
import { TooltipLayer } from "@/components/crm/tooltip-layer";

// Интерфейс русский (ТЗ, раздел 2) — кириллица обязательна в подмножестве.
const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin", "latin-ext", "cyrillic"],
});

// Точечные цифры витрины (дашборд, отчёты). Кириллицы в Doto нет — только цифры и €.
const doto = Doto({
  variable: "--font-doto",
  subsets: ["latin"],
  weight: ["600", "800"],
});

const mono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  title: "CRM застройщика",
  description: "CRM отдела продаж застройщика",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="ru"
      className={`${interTight.variable} ${doto.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <TooltipLayer />
        <DetailsDismiss />
      </body>
    </html>
  );
}
