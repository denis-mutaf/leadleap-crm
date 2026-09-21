import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const role = z.enum(["manager", "head", "admin", "builder"]);
const updateSchema = z
  .object({
    id: z.string().uuid(),
    role: role.optional(),
    is_active: z.boolean().optional(),
  })
  .refine((value) => value.role !== undefined || value.is_active !== undefined);
const inviteSchema = z.object({
  email: z.string().trim().email().max(320),
  full_name: z.string().trim().min(1).max(120),
  role: role.default("manager"),
});
async function actor() {
  const profile = await getCurrentProfile();
  return profile?.role === "admin" ? profile : null;
}

export async function PATCH(request: Request) {
  const current = await actor();
  if (!current)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  const input = parsed.data;
  if (input.id === current.id)
    return NextResponse.json(
      { error: "Нельзя изменить собственную роль или статус" },
      { status: 400 },
    );
  const admin = createAdminClient();
  const { data: target, error: targetError } = await admin
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", input.id)
    .single();
  if (targetError || !target)
    return NextResponse.json(
      { error: "Пользователь не найден" },
      { status: 404 },
    );
  if (
    (input.role === "admin"
      ? false
      : input.role !== undefined && target.role === "admin") ||
    (input.is_active === false && target.role === "admin")
  ) {
    const { count, error } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin")
      .eq("is_active", true);
    if (error)
      return NextResponse.json(
        { error: "Не удалось проверить администраторов" },
        { status: 500 },
      );
    if ((count ?? 0) <= 1)
      return NextResponse.json(
        {
          error:
            "Нельзя отключить или понизить последнего активного администратора",
        },
        { status: 409 },
      );
  }
  const { data: updated, error } = await admin
    .from("profiles")
    .update(
      input.role !== undefined && input.is_active !== undefined
        ? { role: input.role, is_active: input.is_active }
        : input.role !== undefined
          ? { role: input.role }
          : { is_active: input.is_active },
    )
    .eq("id", input.id)
    .select("id, role, is_active")
    .single();
  if (error || !updated)
    return NextResponse.json(
      { error: error?.message ?? "Изменение не подтверждено" },
      { status: 500 },
    );
  return NextResponse.json({ user: updated });
}

export async function POST(request: Request) {
  const current = await actor();
  if (!current)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const parsed = inviteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Некорректные данные приглашения" },
      { status: 400 },
    );
  const { email, full_name, role } = parsed.data;
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name, role },
  });
  if (error || !data.user)
    return NextResponse.json(
      { error: error?.message ?? "Приглашение не отправлено" },
      { status: 502 },
    );
  return NextResponse.json({ invited: true }, { status: 201 });
}
