"use client";

import { useEffect } from "react";
import { writeSavedDealsFilters } from "@/lib/deals-filters";

// Запоминает фильтры воронки, под которые собрана страница. Пустая строка —
// фильтры сняты, cookie стирается.
export function RememberDealsFilters({ value }: { value: string }) {
  useEffect(() => {
    writeSavedDealsFilters(value);
  }, [value]);
  return null;
}
