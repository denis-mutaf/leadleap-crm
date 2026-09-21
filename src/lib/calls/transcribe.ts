// Batch-транскрибация звонка через OpenRouter. Только сервер:
// тянет аудио, держит ключ и пишет итог в public.call_transcripts.
// gpt-transcribe возвращает цельный текст без говорящих и таймкодов —
// их не выдумываем ни в базе, ни в UI.

import { createAdminClient } from "../supabase/admin.ts";

export const OPENROUTER_TRANSCRIBE_MODEL = "openai/gpt-transcribe";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MIN_DURATION_SEC = 5;
const REQUEST_TIMEOUT_MS = 65000;

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
      body: JSON.stringify({
        model: OPENROUTER_TRANSCRIBE_MODEL,
        input_audio: { data: Buffer.from(audio).toString("base64"), format: "mp3" },
        // Короткий контекст вместо фиксации языка: речь в звонках
        // смешанная, румынский чередуется с русским.
        prompt:
          "Apel imobiliar din Moldova. Vorbirea poate alterna între română și rusă. " +
          "Păstrează limba originală și transcrie exact. Termeni posibili: " +
          "IsraGrup, Chișinău, complex locativ, apartament.",
        response_format: "json",
      }),
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => null)) as {
      text?: unknown;
      usage?: unknown;
    } | null;
    if (!res.ok) {
      console.error("transcribe failed", res.status);
      return markFailed(callId, `Распознавание не удалось (ошибка ${res.status})`);
    }
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) return markFailed(callId, "Распознавание вернуло пустой текст");
    const usage = (body?.usage ?? null) as Record<string, unknown> | null;
    const cost =
      usage && typeof usage.cost === "number" && Number.isFinite(usage.cost) ? usage.cost : null;
    const now = new Date().toISOString();
    const { error: saveError } = await admin.from("call_transcripts").upsert(
      {
        call_id: callId,
        status: "completed",
        transcript: text,
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
