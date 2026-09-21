// Перенос истории переписки страницы Facebook в инбокс CRM.
//
// Забирает треды, обновлявшиеся за последние N дней, вместе с сообщениями.
// Контакты и сделки при этом НЕ заводятся: это архив, а не поток лидов —
// полторы сотни новых сделок в воронке сделали бы её нечитаемой. Имя
// собеседника ложится в conversations.display_name, привязать тред к карточке
// менеджер сможет руками.
//
// Идентификатор треда берётся как PSID собеседника, а не как t_... из Graph:
// живой вебхук присылает именно PSID, и новые сообщения должны лечь в тот же
// тред, а не завести второй.
//
// Запуск: node --experimental-strip-types scripts/import-meta-conversations.ts --days=183 [--dry-run]

import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

type Json = Record<string, unknown>;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const days = Number(args.find((a) => a.startsWith("--days="))?.split("=")[1] ?? 183);
const perThread = Number(args.find((a) => a.startsWith("--messages="))?.split("=")[1] ?? 200);

async function loadEnv() {
  const text = await readFile(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of text.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

async function graph(path: string, params: Record<string, string>, token: string): Promise<Json> {
  const url = new URL(`https://graph.facebook.com/v21.0/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  const res = await fetch(url);
  const body = (await res.json()) as Json;
  if (!res.ok) throw new Error(str(obj(body.error).message) ?? `HTTP ${res.status}`);
  return body;
}

async function main() {
  await loadEnv();
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  const pageId = process.env.META_PAGE_ID;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!token || !pageId || !url || !serviceKey) throw new Error("Не хватает переменных окружения");

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const cutoff = new Date(Date.now() - days * 86400000);
  console.log(`Беру треды, обновлявшиеся после ${cutoff.toISOString().slice(0, 10)}${dryRun ? " (сухой прогон)" : ""}`);

  let next: string | null = null;
  let seen = 0;
  let imported = 0;
  let messagesWritten = 0;
  let skippedOld = 0;

  for (;;) {
    const page: Json = next
      ? ((await (await fetch(next)).json()) as Json)
      : await graph(`${pageId}/conversations`, {
          platform: "messenger",
          limit: "25",
          fields: `id,updated_time,unread_count,participants,messages.limit(${perThread}){id,created_time,from,message}`,
        }, token);
    if (obj(page.error).message) throw new Error(String(obj(page.error).message));

    const threads = arr(page.data);
    if (threads.length === 0) break;

    let reachedOld = false;
    for (const rawThread of threads) {
      const thread = obj(rawThread);
      seen += 1;
      const updated = str(thread.updated_time);
      if (updated && new Date(updated) < cutoff) {
        reachedOld = true;
        skippedOld += 1;
        continue;
      }

      const participant = arr(obj(thread.participants).data)
        .map(obj)
        .find((p) => str(p.id) !== pageId);
      const threadId = str(participant?.id);
      if (!threadId) continue;
      const displayName = str(participant?.name) ?? `facebook:${threadId}`;

      const messages = arr(obj(thread.messages).data).map(obj);
      if (messages.length === 0) continue;
      const lastAt = str(messages[0].created_time) ?? updated;

      if (dryRun) {
        imported += 1;
        messagesWritten += messages.length;
        continue;
      }

      const { data: conversation, error: convError } = await admin
        .from("conversations")
        .upsert(
          {
            channel: "facebook",
            external_thread_id: threadId,
            display_name: displayName,
            last_message_at: lastAt,
            unread_count: Number(thread.unread_count ?? 0) || 0,
          },
          { onConflict: "channel,external_thread_id" },
        )
        .select("id")
        .single();
      if (convError) throw new Error(`Переписка ${threadId}: ${convError.message}`);
      const conversationId = conversation.id as string;

      const rows = messages
        .map((message) => {
          const fromId = str(obj(message.from).id);
          return {
            conversation_id: conversationId,
            direction: fromId === pageId ? "out" : "in",
            body: str(message.message),
            external_id: str(message.id),
            sent_at: str(message.created_time) ?? lastAt,
          };
        })
        .filter((row) => row.external_id);

      const { error: msgError } = await admin
        .from("messages")
        .upsert(rows, { onConflict: "conversation_id,external_id", ignoreDuplicates: true });
      if (msgError) throw new Error(`Сообщения ${threadId}: ${msgError.message}`);

      imported += 1;
      messagesWritten += rows.length;
      if (imported % 25 === 0) console.log(`  ...${imported} переписок, ${messagesWritten} сообщений`);
    }

    if (reachedOld) break;
    next = str(obj(page.paging).next);
    if (!next) break;
  }

  console.log(
    `Готово: просмотрено ${seen}, перенесено ${imported} переписок и ${messagesWritten} сообщений, старых пропущено ${skippedOld}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
