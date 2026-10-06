// Подписывает контакты «facebook:<PSID>» настоящим именем из профиля Meta
// (QA B-20). Такие контакты завёл вебхук, пока запрос имени просил поле
// username, которого у Messenger-профиля нет. Меняется только full_name
// контакта и display_name переписки, и только если имя пока техническое.
//
// Запуск: node --no-warnings --experimental-strip-types scripts/backfill-meta-contact-names.ts [--dry-run]
// Нужны META_PAGE_ACCESS_TOKEN и ключи Supabase в .env.local.

import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

type Json = Record<string, unknown>;

const dryRun = process.argv.includes("--dry-run");

async function loadEnv() {
  const text = await readFile(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of text.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

async function profileName(psid: string, token: string): Promise<string | null> {
  for (const fields of ["name", "first_name,last_name"]) {
    const res = await fetch(`https://graph.facebook.com/v21.0/${psid}?fields=${fields}&access_token=${encodeURIComponent(token)}`);
    if (!res.ok) continue;
    const body = (await res.json()) as Json;
    const name = str(body.name) || [str(body.first_name), str(body.last_name)].filter(Boolean).join(" ");
    if (name) return name;
  }
  return null;
}

async function main() {
  await loadEnv();
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!token || !url || !serviceKey) throw new Error("Не хватает переменных окружения");
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data, error } = await admin.from("contacts").select("id, full_name").like("full_name", "facebook:%").limit(500);
  if (error) throw new Error(error.message);
  let named = 0;
  for (const contact of data ?? []) {
    const psid = contact.full_name.slice("facebook:".length);
    const name = await profileName(psid, token);
    if (!name) {
      console.log(`${contact.full_name}: Meta имя не отдала`);
      continue;
    }
    console.log(`${contact.full_name} → ${name}`);
    if (dryRun) continue;
    const upd = await admin.from("contacts").update({ full_name: name }).eq("id", contact.id).eq("full_name", contact.full_name);
    if (upd.error) throw new Error(upd.error.message);
    await admin.from("conversations").update({ display_name: name }).eq("contact_id", contact.id).eq("channel", "facebook");
    named += 1;
  }
  console.log(`Готово: ${named} из ${data?.length ?? 0}${dryRun ? " (сухой прогон, записей нет)" : ""}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
