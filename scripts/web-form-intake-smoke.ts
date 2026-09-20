import { readFile } from "node:fs/promises";

const route = await readFile("src/app/api/webhooks/web-form/route.ts", "utf8");
const helper = await readFile("src/lib/intake/web-form.ts", "utf8");
const migration = await readFile(
  "supabase/migrations/20260922000100_atomic_web_form_intake.sql",
  "utf8",
);

const required = [
  [route, "status: 503", "route retries failures with 5xx"],
  [route, "if (seen.processed_at)", "processed duplicate is acknowledged"],
  [route, "processWebFormEvent(admin, seen.id", "unprocessed duplicate is replayed"],
  [helper, 'admin.rpc("process_web_form_event"', "helper uses atomic RPC"],
  [migration, "<> 'service_role'", "RPC is service-role-only"],
  [migration, "intake_event_id", "writes carry event idempotency marker"],
  [migration, "imported_contact_phones", "RPC searches imported phones"],
  [migration, "Ambiguous phone match", "ambiguous matches fail closed"],
] as const;

for (const [text, needle, description] of required) {
  if (!text.includes(needle)) throw new Error(`Missing invariant: ${description}`);
}
if (route.includes("return NextResponse.json({ ok: true }, { status: 200 });\n  } catch")) {
  throw new Error("Route still acknowledges processing failures");
}

console.log("web-form intake smoke: raw-event retry, atomic RPC, service auth, imported ambiguity, idempotency passed");
