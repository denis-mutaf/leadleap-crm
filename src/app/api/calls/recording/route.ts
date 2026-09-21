import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ссылка на запись: своя копия из приватного бакета — основной источник
// (signed URL после проверки прав через RLS). Живая ссылка АТС —
// запасной путь, пока копия ещё не забрана архивом.
export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile || !["manager", "head", "admin"].includes(profile.role))
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Нет id звонка" }, { status: 400 });

  const supabase = await createClient();
  const { data: call, error } = await supabase
    .from("calls")
    .select("id,recording_path,recording_url,recording_gone_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Звонок недоступен" }, { status: 400 });
  if (!call) return NextResponse.json({ error: "Звонок не найден" }, { status: 404 });

  const path = call.recording_path as string | null;
  if (path) {
    try {
      const admin = createAdminClient();
      const { data, error: signError } = await admin.storage
        .from("call-recordings")
        .createSignedUrl(path, 600);
      if (signError || !data?.signedUrl)
        return NextResponse.json({ error: "Не удалось открыть запись" }, { status: 502 });
      return NextResponse.json({ url: data.signedUrl, source: "storage" });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Не удалось открыть запись" },
        { status: 502 },
      );
    }
  }
  const live = (call.recording_url as string | null)?.trim();
  if (live) return NextResponse.json({ url: live, source: "pbx" });
  return NextResponse.json({ error: "Записи нет", gone: true }, { status: 410 });
}
