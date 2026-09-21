// Общая логика забора записей разговоров с АТС Moldcell в наш Storage.
//
// Moldcell стирает mp3 примерно через 90 дней, а ссылка в calls.recording_url
// после этого отдаёт 404 навсегда. Поэтому каждый звонок из очереди забираем
// к себе в приватный бакет call-recordings, а в calls.recording_path кладём
// путь копии. Повторный запуск безопасен: звонки с готовой копией
// или с пометкой «стёрто у АТС» в выборку не попадают.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "../supabase/admin.ts";

type CallRow = {
  id: string;
  recording_url: string;
  started_at: string | null;
};

export type ArchiveResult = {
  processed: number;
  stored: number;
  gone: number;
  failed: number;
  bytes: number;
};

const BUCKET = "call-recordings";
const PAGE_SIZE = 200;
const CONCURRENCY = 6;
const MAX_ATTEMPTS = 3;
const RETRY_PAUSE_MS = 2000;
const FETCH_TIMEOUT_MS = 30000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Качает один звонок: 200 — льём в бакет, 404/410 — помечаем стёртым,
// остальное повторяем до трёх попыток и сдаёмся без падения.
async function processCall(
  client: SupabaseClient,
  call: CallRow,
): Promise<{ outcome: "stored" | "gone" | "failed"; bytes: number }> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(call.recording_url, { signal: controller.signal });
      if (res.status === 404 || res.status === 410) {
        await res.body?.cancel().catch(() => {});
        const { error } = await client
          .from("calls")
          .update({ recording_gone_at: new Date().toISOString() })
          .eq("id", call.id)
          .is("recording_path", null);
        return { outcome: error ? "failed" : "gone", bytes: 0 };
      }
      if (res.ok) {
        const buf = new Uint8Array(await res.arrayBuffer());
        // Путь раскладываем по месяцу звонка, чтобы бакет не лежал плоским списком.
        const started = call.started_at ? new Date(call.started_at) : new Date();
        const path = `${started.getUTCFullYear()}/${String(started.getUTCMonth() + 1).padStart(2, "0")}/${call.id}.mp3`;
        const { error: uploadError } = await client.storage
          .from(BUCKET)
          .upload(path, buf, { contentType: "audio/mpeg", upsert: true });
        if (uploadError) return { outcome: "failed", bytes: 0 };
        const { error: updateError } = await client
          .from("calls")
          .update({ recording_path: path, recording_stored_at: new Date().toISOString() })
          .eq("id", call.id);
        return { outcome: updateError ? "failed" : "stored", bytes: updateError ? 0 : buf.byteLength };
      }
      await res.body?.cancel().catch(() => {});
    } catch {
      // Сеть и таймаут — временное, уходим на повтор ниже.
    } finally {
      clearTimeout(timer);
    }
    if (attempt < MAX_ATTEMPTS) await sleep(RETRY_PAUSE_MS);
  }
  return { outcome: "failed", bytes: 0 };
}

export async function archiveCallRecordings(options?: {
  limit?: number | null;
  since?: string | null;
  onProgress?: (info: {
    processed: number;
    stored: number;
    gone: number;
    failed: number;
    remaining: number | null;
  }) => void;
}): Promise<ArchiveResult> {
  const client = createAdminClient();
  const limit = options?.limit ?? null;
  const since = options?.since ?? null;

  let stored = 0;
  let gone = 0;
  let failed = 0;
  let done = 0;
  let totalBytes = 0;
  let remaining: number | null = null;
  let finishedByLimit = false;

  // Очередь читаем порциями: свежие звонки важнее — старые уже либо
  // скопированы, либо признаны стёртыми, а свежие исчезнут следующими.
  // После каждой порции выборку начинаем заново: обработанные строки
  // сами выпадают из условия, так что сдвиг не нужен и повторов нет.
  for (;;) {
    if (limit !== null && done >= limit) {
      finishedByLimit = true;
      break;
    }
    let query = client
      .from("calls")
      .select("id,recording_url,started_at", { count: "exact" })
      .not("recording_url", "is", null)
      // Пустая строка — не ссылка, а мусор в данных: fetch по ней всегда
      // падает, а помечать «стёрто у АТС» её нельзя — там ничего и не было.
      .neq("recording_url", "")
      .is("recording_path", null)
      .is("recording_gone_at", null)
      .order("started_at", { ascending: false })
      .limit(PAGE_SIZE);
    if (since) query = query.gte("started_at", since);
    const { data, error, count } = await query;
    if (error) throw new Error(`Выборка звонков: ${error.message}`);
    if (count !== null) remaining = count;
    const rows = (data ?? []) as CallRow[];
    if (rows.length === 0) break;

    // Параллельность держим ровно 6: АТС чужая, перегружать её нельзя.
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      let batch = rows.slice(i, i + CONCURRENCY);
      if (limit !== null) batch = batch.slice(0, Math.max(0, limit - done));
      if (batch.length === 0) {
        finishedByLimit = true;
        break;
      }
      const outcomes = await Promise.all(batch.map((call) => processCall(client, call)));
      for (const { outcome, bytes } of outcomes) {
        done += 1;
        if (outcome === "stored") {
          stored += 1;
          totalBytes += bytes;
        } else if (outcome === "gone") gone += 1;
        else failed += 1;
        if (done % 50 === 0) {
          if (remaining !== null) remaining = Math.max(0, remaining - 50);
          options?.onProgress?.({ processed: done, stored, gone, failed, remaining });
        }
        if (limit !== null && done >= limit) finishedByLimit = true;
      }
      if (finishedByLimit) break;
    }
    if (finishedByLimit) break;
    if (rows.length < PAGE_SIZE) break;
  }

  return { processed: done, stored, gone, failed, bytes: totalBytes };
}
