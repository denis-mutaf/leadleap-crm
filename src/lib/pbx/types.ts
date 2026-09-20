// Типы протокола Moldcell PBX REST API.
// Первоисточник: docs/integrations/moldcell-pbx-rest-api.txt (расшифровка официального PDF).
// Имена параметров — дословно как в протоколе.

export type PbxCmd = "history" | "event" | "contact";

export type PbxEventType =
  | "INCOMING"
  | "ACCEPTED"
  | "COMPLETED"
  | "CANCELLED"
  | "OUTGOING"
  | "TRANSFERRED";

// cmd=history от АТС к CRM: статусы дословно из раздела 4.1.
export type PbxHistoryStatus =
  | "Success"
  | "Missed"
  | "Cancel"
  | "Busy"
  | "NotAvailable"
  | "NotAllowed"
  | "NotFound";

// Наш enum call_status из миграции 20260920180300_channels.sql.
export type CallStatus =
  | "success"
  | "missed"
  | "cancel"
  | "busy"
  | "not_available"
  | "not_allowed"
  | "not_found";

export type CallDirection = "in" | "out";

// Сырое тело вебхука: АТС шлёт application/x-www-form-urlencoded,
// все значения — строки.
export type PbxRawBody = Record<string, string | undefined>;

export interface PbxHistoryPayload extends PbxRawBody {
  cmd: "history";
  type: string; // in/out
  status: string;
  phone: string;
  user: string;
  start: string; // YYYYmmddTHHMMSSZ
  duration: string;
  callid: string;
  crm_token: string;
  link?: string;
  ext?: string;
  groupRealName?: string;
  telnum?: string;
  diversion?: string;
}

export interface PbxEventPayload extends PbxRawBody {
  cmd: "event";
  type: string; // PbxEventType
  phone: string;
  user: string;
  direction: string; // in/out
  callid: string;
  crm_token: string;
  diversion?: string;
  groupRealName?: string;
  ext?: string;
  telnum?: string;
}

export interface PbxContactPayload extends PbxRawBody {
  cmd: "contact";
  phone: string;
  callid: string;
  crm_token: string;
}
