// Типы и честные вычисления экрана «Звонки».
// Результат выводится из направления и длительности (карта calls.md):
// сырые коды в raw у импорта и живых событий разные, сравнивать их нельзя.

export type CallDirection = "in" | "out";

export type CallResult = "talked" | "missed" | "failed" | "busy";

export type CallTranscriptStatus = "pending" | "processing" | "completed" | "failed";

// Строка public.call_transcripts для панели звонка. Текст цельный:
// gpt-transcribe не возвращает ни говорящих, ни таймкоды.
export type CallTranscriptRow = {
  call_id: string;
  status: CallTranscriptStatus | string | null;
  transcript: string | null;
  language: string | null;
  model: string | null;
  error: string | null;
  created_at: string | null;
  updated_at: string | null;
  completed_at: string | null;
};

export type TranscriptSegment = {
  id: string;
  startsAtSec: number;
  speaker: "manager" | "client";
  speakerName: string;
  text: string;
};

export type CallTranscript = {
  callId: string;
  summary: { about: string; decided: string; nextStep: string } | null;
  segments: TranscriptSegment[];
};

export type CallRow = {
  id: string;
  external_id: string | null;
  direction: CallDirection | string | null;
  status: string | null;
  from_phone: string | null;
  to_phone: string | null;
  contact_id: string | null;
  deal_id: string | null;
  user_id: string | null;
  started_at: string | null;
  duration_sec: number | null;
  recording_url: string | null;
  recording_path: string | null;
  recording_stored_at: string | null;
  recording_gone_at: string | null;
  note: string | null;
  note_by: string | null;
  note_at: string | null;
  called_back_at: string | null;
  // Всё, что нужно клиенту из сырого события АТС, сервер вычисляет заранее
  // и кладёт сюда числами/строками: сам raw в браузер не уходит —
  // внутри лежит crm_token АТС.
  wait_sec: number | null;
  extension: string | null;
  contact?: { id: string; full_name: string } | null;
  deal?: { id: string; title: string | null; stage_id: string | null } | null;
  deal_stage?: string | null;
  employee?: { id: string; full_name: string } | null;
  note_author?: { id: string; full_name: string } | null;
};

// Серверный select: только нужные поля, без raw целиком в клиенте.
// Сделку тянем с stage_id, имя этапа добрасываем отдельной выборкой
// из stages (у deals нет колонки stage). Сотрудников и авторов заметок
// тоже добрасываем отдельными запросами: у calls два FK в profiles,
// а имена констрейнтов для хинтов PostgREST неизвестны.
export const CALLS_SELECT =
  "id,external_id,direction,status,from_phone,to_phone,contact_id,deal_id,user_id,started_at,duration_sec,recording_url,recording_path,recording_stored_at,recording_gone_at,note,note_by,note_at,called_back_at,raw,contact:contacts(id,full_name),deal:deals(id,title,stage_id)";

// Сырая строка из базы: колонки calls + raw только для серверного разбора
// и джойны контактов/сделок. Клиенту уходит CallRow без raw.
export type CallDbRow = {
  id: string;
  external_id: string | null;
  direction: string | null;
  status: string | null;
  from_phone: string | null;
  to_phone: string | null;
  contact_id: string | null;
  deal_id: string | null;
  user_id: string | null;
  started_at: string | null;
  duration_sec: number | null;
  recording_url: string | null;
  recording_path: string | null;
  recording_stored_at: string | null;
  recording_gone_at: string | null;
  note: string | null;
  note_by: string | null;
  note_at: string | null;
  called_back_at: string | null;
  raw: Record<string, unknown> | null;
  contact?: { id: string; full_name: string } | null;
  deal?: { id: string; title: string | null; stage_id: string | null } | null;
};

// answered_at у звонков пустой — время ожидания лежит в raw.wait строкой
// (например «13»). Разбираем на сервере, клиенту отдаём число.
export function parseWaitSec(raw: Record<string, unknown> | null): number | null {
  if (!raw) return null;
  const params = (raw.params ?? raw) as Record<string, unknown>;
  const candidate = params.wait ?? raw.wait;
  if (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0)
    return Math.round(candidate);
  if (typeof candidate === "string" && candidate.trim() !== "") {
    const num = Number(candidate.replace(",", "."));
    if (Number.isFinite(num) && num >= 0) return Math.round(num);
  }
  return null;
}

function parseRawString(raw: Record<string, unknown> | null, keys: string[]): string | null {
  if (!raw) return null;
  const params = (raw.params ?? raw) as Record<string, unknown>;
  for (const key of keys) {
    const value = params[key] ?? raw[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

// raw живёт только на сервере: достаём ожидание и внутренний номер,
// external_id берём из колонки и лишь при её пустоте — из raw
// (ключ у АТС пишется слитно: callid). Чистая строка уходит
// клиентским компонентам без raw.
export function toClientCall(row: CallDbRow): CallRow {
  const { raw: serverRaw, contact, deal, ...cols } = row;
  return {
    ...cols,
    contact: contact ?? null,
    deal: deal ?? null,
    external_id: cols.external_id ?? parseRawString(serverRaw, ["callid", "call_id", "callId", "uuid"]),
    wait_sec: parseWaitSec(serverRaw),
    extension: parseRawString(serverRaw, ["extension", "internal", "user", "login"]),
  };
}

export function callDuration(call: Pick<CallRow, "duration_sec">): number {
  return Math.max(0, call.duration_sec ?? 0);
}

// Имя контакта замусорено импортом («37367690523, исходящий успешный»
// или просто номер): такое именем не считаем, показываем номер.
export function displayName(call: CallRow, phone: string): string | null {
  const name = call.contact?.full_name?.trim();
  if (!name) return null;
  const digits = name.replace(/\D/g, "");
  if (digits.length >= 7 && /^[\d\s,+\-().а-яА-Яa-zA-Z]*$/.test(name)) {
    const phoneDigits = phone.replace(/\D/g, "");
    if (digits === phoneDigits) return null;
    if (/исходящий|входящий|успешный|пропущен/i.test(name)) return null;
  }
  return name;
}

export function callPhone(call: CallRow): string {
  if (call.direction === "out") return call.to_phone ?? call.from_phone ?? "—";
  return call.from_phone ?? call.to_phone ?? "—";
}

export function callWaitSec(call: Pick<CallRow, "wait_sec">): number | null {
  return call.wait_sec;
}

export function callResult(call: CallRow): CallResult {
  if (call.status === "busy") return "busy";
  const talked = callDuration(call) > 0;
  if (call.direction === "in") return talked ? "talked" : "missed";
  return talked ? "talked" : "failed";
}

export const RESULT_LABEL: Record<CallResult, string> = {
  talked: "Поговорили",
  missed: "Пропущенный",
  failed: "Не дозвонились",
  busy: "Занято",
};

export function needsCallback(call: CallRow): boolean {
  return callResult(call) === "missed" && !call.called_back_at;
}

// Пустой recording_url ('' или null) у недозвонов — нормальное
// «записи нет», а не ошибка: разговора не было, записывать нечего.
export function hasRecording(call: Pick<CallRow, "recording_path" | "recording_url">): boolean {
  if (call.recording_path && call.recording_path.trim() !== "") return true;
  return !!call.recording_url && call.recording_url.trim() !== "";
}

export function formatDuration(totalSec: number | null | undefined): string {
  if (totalSec === null || totalSec === undefined || totalSec <= 0) return "—";
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatWait(sec: number | null): string {
  if (sec === null) return "—";
  return `${sec} с`;
}

export function formatCallDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day}.${month} ${hh}:${mm}`;
}
