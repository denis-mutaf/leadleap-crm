import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  callId: z.string().uuid(),
  note: z.string().trim().max(2000),
});

// Заметка к звонку: пишет note + note_by/note_at текущего пользователя.
// Пустая строка стирает заметку, но авторство остаётся честным.
export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile || !["manager", "head", "admin"].includes(profile.role))
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Заметка пустая или слишком длинная" }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("calls")
    .update({
      note: parsed.data.note || null,
      note_by: profile.id,
      note_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.callId)
    .select("id,note,note_by,note_at")
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Не удалось сохранить заметку" }, { status: 400 });
  if (!data) return NextResponse.json({ error: "Звонок не найден" }, { status: 404 });
  return NextResponse.json({ ok: true, call: data, author: profile.full_name });
}
