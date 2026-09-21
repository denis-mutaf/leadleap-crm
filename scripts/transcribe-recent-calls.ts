// Batch-расшифровка свежих звонков через общий helper.
//
// Запуск: node --no-warnings --experimental-strip-types scripts/transcribe-recent-calls.ts [--limit N]
// Лимит не больше 5 за запуск: каждая расшифровка — платный запрос.
// Печатаем только id/status/cost — текст разговоров в лог не пишем.

import { readFile } from "node:fs/promises";
import { createAdminClient } from "../src/lib/supabase/admin.ts";
import { transcribeCall } from "../src/lib/calls/transcribe.ts";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 5;

const args = process.argv.slice(2);
const limitRaw =
  args.find((a) => a.startsWith("--limit="))?.split("=")[1] ??
  (args.includes("--limit") ? args[args.indexOf("--limit") + 1] : undefined);
const parsed = limitRaw && /^\d+$/.test(limitRaw) ? Number(limitRaw) : DEFAULT_LIMIT;
const limit = Math.min(Math.max(1, parsed), MAX_LIMIT);

async function loadEnv() {
  const text = await readFile(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of text.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

function formatCost(cost: number | null | undefined): string {
  if (typeof cost !== "number" || !Number.isFinite(cost)) return "—";
  return `$${cost.toFixed(4)}`;
}

async function main() {
  await loadEnv();
  const admin = createAdminClient();

  // Кандидаты: свежие звонки со своей копией записи и разговорной длиной.
  const { data: calls, error } = await admin
    .from("calls")
    .select("id,duration_sec")
    .not("recording_path", "is", null)
    .gte("duration_sec", 12)
    .lte("duration_sec", 600)
    .order("started_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`Выборка звонков: ${error.message}`);
  const ids = ((calls ?? []).map((c) => c.id) as string[]).filter(Boolean);
  if (!ids.length) {
    console.log("Кандидатов нет: свежих звонков с копией записи нет.");
    return;
  }
  const { data: done, error: doneError } = await admin
    .from("call_transcripts")
    .select("call_id")
    .in("call_id", ids)
    .eq("status", "completed");
  if (doneError) throw new Error(`Проверка расшифровок: ${doneError.message}`);
  const completed = new Set((done ?? []).map((d) => d.call_id as string));
  const queue = ids.filter((id) => !completed.has(id)).slice(0, limit);
  if (!queue.length) {
    console.log("Всё свежее уже расшифровано.");
    return;
  }

  // Строго последовательно: бережём таймауты и бюджет.
  for (const id of queue) {
    const outcome = await transcribeCall(id);
    if (outcome.status === "completed") {
      console.log(`${id} completed cost=${formatCost(outcome.cost)}`);
    } else if (outcome.status === "processing") {
      console.log(`${id} processing cost=—`);
    } else {
      console.log(`${id} failed cost=— (${outcome.error})`);
    }
  }
  console.log(`Готово: ${queue.length} из очереди ${limit}.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
