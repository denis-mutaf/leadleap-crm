// Копия записей разговоров из АТС Moldcell в наш Storage.
//
// Запуск: node --no-warnings --experimental-strip-types scripts/archive-call-recordings.ts [--limit N] [--since YYYY-MM-DD]

import { readFile } from "node:fs/promises";
import { archiveCallRecordings } from "../src/lib/calls/archive.ts";

const args = process.argv.slice(2);
const limitRaw =
  args.find((a) => a.startsWith("--limit="))?.split("=")[1] ??
  (args.includes("--limit") ? args[args.indexOf("--limit") + 1] : undefined);
const sinceRaw =
  args.find((a) => a.startsWith("--since="))?.split("=")[1] ??
  (args.includes("--since") ? args[args.indexOf("--since") + 1] : undefined);
const limit = limitRaw && /^\d+$/.test(limitRaw) ? Number(limitRaw) : null;
const since = sinceRaw && /^\d{4}-\d{2}-\d{2}$/.test(sinceRaw) ? sinceRaw : null;

async function loadEnv() {
  const text = await readFile(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of text.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

async function main() {
  await loadEnv();
  const result = await archiveCallRecordings({
    limit,
    since,
    onProgress: ({ processed, stored, gone, failed, remaining }) => {
      console.log(
        `  ...обработано ${processed}, скопировано ${stored}, стёрто у АТС ${gone}, ошибок ${failed}, осталось ${remaining ?? "?"}`,
      );
    },
  });
  const mb = (result.bytes / 1048576).toFixed(1);
  console.log(
    `Готово: обработано ${result.processed}, скопировано ${result.stored}, стёрто у АТС ${result.gone}, ошибок ${result.failed}, объём ${mb} МБ`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
