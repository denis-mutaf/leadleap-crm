// Маппинг статусов АТС -> наш enum call_status.
// Слева — дословно статусы из раздела 4.1 протокола, справа —
// значения enum call_status из миграции 20260920180300_channels.sql.
import type { CallStatus } from "./types";

export const PBX_STATUS_MAP: Record<string, CallStatus> = {
  Success: "success",
  Missed: "missed",
  Cancel: "cancel",
  Busy: "busy",
  NotAvailable: "not_available",
  NotAllowed: "not_allowed",
  NotFound: "not_found",
};

export function mapPbxStatus(raw: string | undefined | null): CallStatus | null {
  if (!raw) return null;
  return PBX_STATUS_MAP[raw] ?? null;
}

// Тип звонка АТС (in/out) -> наш enum call_direction.
export function mapPbxDirection(raw: string | undefined | null): "in" | "out" | null {
  if (raw === "in" || raw === "out") return raw;
  return null;
}

// Формат времени АТС YYYYmmddTHHMMSSZ (UTC), раздел 4.1/5.4.
export function parsePbxStart(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(raw);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

// Нормализация телефона — JS-копия SQL-функции normalize_phone
// из миграции 20260920180100_contacts_and_deals.sql.
export function normalizePhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 8) return `+373${digits}`;
  if (digits.length === 9 && digits.startsWith("0")) return `+373${digits.slice(1)}`;
  return `+${digits}`;
}
