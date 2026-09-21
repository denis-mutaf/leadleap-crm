import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { makeCall } from "@/lib/pbx/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ callId: z.string().uuid() });

// «Перезвонить»: поднимает трубку у менеджера и набирает номер клиента
// через makeCall. АТС ждёт логин сотрудника (u030/u040/u080/admin),
// а не UUID профиля.
export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile || !["manager", "head", "admin"].includes(profile.role))
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  if (!profile.pbx_login)
    return NextResponse.json(
      { error: "У сотрудника не настроена телефония" },
      { status: 422 },
    );
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Нет id звонка" }, { status: 400 });

  const supabase = await createClient();
  const { data: call, error } = await supabase
    .from("calls")
    .select("id,direction,from_phone,to_phone,user_id")
    .eq("id", parsed.data.callId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Звонок недоступен" }, { status: 400 });
  if (!call) return NextResponse.json({ error: "Звонок не найден" }, { status: 404 });

  const phone = (
    call.direction === "out" ? call.to_phone || call.from_phone : call.from_phone || call.to_phone
  ) as string | null;
  if (!phone) return NextResponse.json({ error: "У звонка нет номера" }, { status: 422 });

  try {
    const callId = await makeCall(profile.pbx_login, phone);
    return NextResponse.json({ ok: true, pbxCallId: callId });
  } catch (e) {
    const message = e instanceof Error ? e.message : "АТС не ответила";
    return NextResponse.json({ error: `Не удалось позвонить: ${message}` }, { status: 502 });
  }
}
