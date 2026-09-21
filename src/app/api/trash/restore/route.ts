import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
const entities = ["deals", "contacts", "notes", "tasks"] as const;
const uuid = (value: unknown) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile || !["manager", "head", "admin"].includes(profile.role))
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  try {
    const input = (await request.json()) as Record<string, unknown>;
    if (!entities.includes(input.entity as never) || !uuid(input.id))
      return NextResponse.json(
        { error: "Некорректная запись" },
        { status: 400 },
      );
    const result = await (
      await createClient()
    ).rpc("restore_crm_record", { p_entity: input.entity, p_id: input.id });
    if (result.error)
      return NextResponse.json(
        { error: "Не удалось восстановить запись" },
        { status: 400 },
      );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
}
