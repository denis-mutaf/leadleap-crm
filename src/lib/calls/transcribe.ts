// Batch-транскрибация звонка через OpenRouter. Только сервер:
// тянет аудио, держит ключ и пишет итог в public.call_transcripts.
// microsoft/mai-transcribe-2 возвращает verbose_json с диаризацией:
// сегменты складываем в segments, цельный текст остаётся запасным путём.

import { createAdminClient } from "../supabase/admin.ts";
import type { CallTranscriptSegment } from "./types.ts";

export const OPENROUTER_TRANSCRIBE_MODEL = "microsoft/mai-transcribe-2";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MIN_DURATION_SEC = 5;
const REQUEST_TIMEOUT_MS = 65000;

const PHRASE_LIST = [
  "IsraGrup",
  "Isragrup",
  "Chișinău",
  "Chisinau",
  "complex locativ",
  "apartament",
];

export type TranscribeStatus = "pending" | "processing" | "completed" | "failed";

export type TranscribeOutcome =
  | { status: "completed"; cost: number | null }
  | { status: "processing" }
  | { status: "failed"; error: string };

function openRouterKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  return key;
}

// Безопасное сообщение наружу: без ключа, URL и байтов аудио.
async function markFailed(callId: string, message: string): Promise<TranscribeOutcome> {
  const admin = createAdminClient();
  await admin.from("call_transcripts").upsert(
    {
      call_id: callId,
      status: "failed",
      error: message,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "call_id" },
  );
  return { status: "failed", error: message };
}

// Только валидные {id,start,end,speaker,text}: остальное отбрасываем,
// speaker без значения — строка "unknown". Пусто — [].
function parseSegments(raw: unknown): CallTranscriptSegment[] {
  if (!Array.isArray(raw)) return [];
  const out: CallTranscriptSegment[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i] as Record<string, unknown> | null;
    if (!item || typeof item !== "object") continue;
    const text = typeof item.text === "string" ? item.text.trim() : "";
    if (!text) continue;
    const start = typeof item.start === "number" ? item.start : Number.NaN;
    const end = typeof item.end === "number" ? item.end : Number.NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) continue;
    const speaker =
      typeof item.speaker === "string" && item.speaker.trim() !== ""
        ? item.speaker.trim()
        : typeof item.speaker === "number" && Number.isFinite(item.speaker)
          ? String(item.speaker)
          : "unknown";
    const id =
      typeof item.id === "string" && item.id.trim() !== "" ? item.id.trim() : `seg-${i}`;
    out.push({ id, start, end, speaker, text });
  }
  return out;
}

export async function transcribeCall(
  callId: string,
  options?: { force?: boolean },
): Promise<TranscribeOutcome> {
  const force = options?.force === true;
  const admin = createAdminClient();

  const { data: existing, error: existingError } = await admin
    .from("call_transcripts")
    .select("status")
    .eq("call_id", callId)
    .maybeSingle();
  if (existingError) return { status: "failed", error: "Не удалось проверить статус расшифровки" };
  if (!force && existing?.status === "processing") return { status: "processing" };

  let apiKey: string;
  try {
    apiKey = openRouterKey();
  } catch {
    return markFailed(callId, "Расшифровка не настроена: нет ключа OpenRouter");
  }

  const { data: call, error: callError } = await admin
    .from("calls")
    .select("id,duration_sec,recording_path,recording_url")
    .eq("id", callId)
    .maybeSingle();
  if (callError || !call) return markFailed(callId, "Звонок не найден");
  if ((call.duration_sec ?? 0) < MIN_DURATION_SEC)
    return markFailed(callId, "Слишком короткий звонок для расшифровки");

  // Аудио: своя копия из приватного бакета предпочтительно,
  // живая ссылка АТС — запасной путь.
  let audio: Uint8Array | null = null;
  const path = (call.recording_path as string | null)?.trim();
  if (path) {
    const { data: blob, error: downloadError } = await admin.storage
      .from("call-recordings")
      .download(path);
    if (downloadError || !blob) return markFailed(callId, "Не удалось забрать запись из хранилища");
    audio = new Uint8Array(await blob.arrayBuffer());
  } else {
    const url = (call.recording_url as string | null)?.trim();
    if (!url) return markFailed(callId, "У звонка нет записи для расшифровки");
    try {
      const res = await fetch(url);
      if (!res.ok) return markFailed(callId, "Запись недоступна для расшифровки");
      audio = new Uint8Array(await res.arrayBuffer());
    } catch {
      return markFailed(callId, "Не удалось скачать запись для расшифровки");
    }
  }
  if (audio.length > MAX_AUDIO_BYTES)
    return markFailed(callId, "Запись слишком большая для расшифровки (лимит 25 МБ)");

  // Статус processing — до запроса, чтобы повторы не плодили задачи.
  await admin.from("call_transcripts").upsert(
    {
      call_id: callId,
      status: "processing",
      error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "call_id" },
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      // Язык не фиксируем: речь смешанная, румынский чередуется с русским.
      body: JSON.stringify({
        model: OPENROUTER_TRANSCRIBE_MODEL,
        input_audio: { data: Buffer.from(audio).toString("base64"), format: "mp3" },
        response_format: "verbose_json",
        timestamp_granularities: ["word"],
        provider: {
          options: {
            azure: {
              diarization: { enabled: true },
              phraseList: { phrases: PHRASE_LIST },
              enhancedMode: { modelOptions: { transcribeStyle: "clean" } },
            },
          },
        },
      }),
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => null)) as {
      text?: unknown;
      language?: unknown;
      segments?: unknown;
      usage?: unknown;
    } | null;
    if (!res.ok) {
      console.error("transcribe failed", res.status);
      return markFailed(callId, `Распознавание не удалось (ошибка ${res.status})`);
    }
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) return markFailed(callId, "Распознавание вернуло пустой текст");
    const language =
      typeof body?.language === "string" && body.language.trim() !== ""
        ? body.language.trim()
        : null;
    const segments = parseSegments(body?.segments);
    const usage = (body?.usage ?? null) as Record<string, unknown> | null;
    const cost =
      usage && typeof usage.cost === "number" && Number.isFinite(usage.cost) ? usage.cost : null;
    const now = new Date().toISOString();
    const { error: saveError } = await admin.from("call_transcripts").upsert(
      {
        call_id: callId,
        status: "completed",
        transcript: text,
        language,
        segments,
        model: OPENROUTER_TRANSCRIBE_MODEL,
        usage: usage ?? { model: OPENROUTER_TRANSCRIBE_MODEL },
        error: null,
        completed_at: now,
        updated_at: now,
      },
      { onConflict: "call_id" },
    );
    if (saveError) return markFailed(callId, "Не удалось сохранить расшифровку");
    return { status: "completed", cost };
  } catch (e) {
    console.error("transcribe failed", e instanceof Error ? e.message : "network");
    const message =
      e instanceof Error && e.name === "AbortError"
        ? "Распознавание не уложилось в минуту — попробуйте позже"
        : "Не удалось связаться с распознаванием";
    return markFailed(callId, message);
  } finally {
    clearTimeout(timer);
  }
}
