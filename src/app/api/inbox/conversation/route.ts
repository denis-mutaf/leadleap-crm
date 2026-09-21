import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  conversationId: z.string().uuid(),
  // read: false — ручное «оставить непрочитанным», чтобы диалог не потерялся.
  read: z.boolean().optional(),
  assign: z.enum(["me", "none"]).optional(),
});

export async function PATCH(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile || !["manager", "head", "admin"].includes(profile.role))
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  const { conversationId, read, assign } = parsed.data;
  if (read === undefined && assign === undefined)
    return NextResponse.json({ error: "Нечего менять" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (read === true) {
    patch.last_read_at = new Date().toISOString();
    patch.unread_count = 0;
  }
  // Непрочитанным диалог становится «до последнего письма клиента»: отметка
  // сдвигается назад, а не обнуляется, иначе он больше никогда не прочитается.
  if (read === false) patch.last_read_at = null;
  if (assign === "me") patch.assigned_to = profile.id;
  if (assign === "none") patch.assigned_to = null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversations")
    .update(patch)
    .eq("id", conversationId)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Не удалось обновить диалог" }, { status: 400 });
  if (!data) return NextResponse.json({ error: "Диалог не найден" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
