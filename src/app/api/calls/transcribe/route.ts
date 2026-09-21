import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { transcribeCall } from "@/lib/calls/transcribe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  callId: z.string().uuid(),
  force: z.boolean().optional(),
});

// Запуск расшифровки звонка. Доступ к звонку проверяет RLS через
// пользовательский клиент; тяжёлую работу делает общий helper.
export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile || !["manager", "head", "admin"].includes(profile.role))
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Нет id звонка" }, { status: 400 });

  const supabase = await createClient();
  const { data: call, error } = await supabase
    .from("calls")
    .select("id")
    .eq("id", parsed.data.callId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Звонок недоступен" }, { status: 400 });
  if (!call) return NextResponse.json({ error: "Звонок не найден" }, { status: 404 });

  const outcome = await transcribeCall(parsed.data.callId, { force: parsed.data.force });
  if (outcome.status === "processing")
    return NextResponse.json({ error: "Расшифровка уже идёт" }, { status: 409 });
  if (outcome.status === "failed")
    return NextResponse.json({ error: outcome.error }, { status: 422 });
  return NextResponse.json({ ok: true, cost: outcome.cost });
}
