import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const types = ["text", "number", "date", "select", "checkbox"] as const;
const entities = ["deal", "contact"] as const;
const fail = (error: string, status = 400) =>
  NextResponse.json({ error }, { status });
async function admin() {
  const profile = await getCurrentProfile();
  return profile?.role === "admin" ? profile : null;
}
async function read(request: Request) {
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
const isUuid = (value: unknown) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
function list(value: unknown) {
  return Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 100 &&
    value.every(
      (item) =>
        typeof item === "string" &&
        item.trim().length > 0 &&
        item.length <= 120,
    )
    ? value.map((item) => (item as string).trim())
    : null;
}

export async function POST(request: Request) {
  const profile = await admin();
  const input = await read(request);
  if (!profile) return fail("Недостаточно прав", 403);
  if (
    !input ||
    typeof input.label !== "string" ||
    input.label.trim().length === 0 ||
    input.label.length > 120 ||
    !entities.includes(input.entity as never) ||
    !types.includes(input.field_type as never)
  )
    return fail("Проверьте название, сущность и тип");
  const options = input.field_type === "select" ? list(input.options) : [];
  if (options === null) return fail("Добавьте корректные варианты списка");
  const supabase = await createClient();
  const last = await supabase
    .from("custom_field_defs")
    .select("position")
    .eq("entity", input.entity)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last.error) return fail("Не удалось определить порядок поля");
  const position = (last.data?.position ?? -1) + 1;
  if (position > 32767) return fail("Достигнут предел количества полей");
  const result = await supabase
    .from("custom_field_defs")
    .insert({
      key: `${input.entity}_${crypto.randomUUID()}`,
      label: input.label.trim(),
      entity: input.entity,
      field_type: input.field_type,
      options,
      position,
      is_required: input.is_required === true,
      is_active: true,
      auto_created: false,
      created_by: profile.id,
    })
    .select("*")
    .single();
  if (result.error || !result.data) return fail("Не удалось создать поле");
  return NextResponse.json({ field: result.data });
}

export async function PATCH(request: Request) {
  const profile = await admin();
  const input = await read(request);
  if (!profile) return fail("Недостаточно прав", 403);
  if (!input || !isUuid(input.id)) return fail("Некорректный идентификатор");
  const supabase = await createClient();
  const existing = await supabase
    .from("custom_field_defs")
    .select("field_type")
    .eq("id", input.id)
    .single();
  if (existing.error || !existing.data) return fail("Поле не найдено", 404);
  const update: Record<string, unknown> = {};
  if (input.label !== undefined) {
    if (
      typeof input.label !== "string" ||
      input.label.trim().length === 0 ||
      input.label.length > 120
    )
      return fail("Некорректное название");
    update.label = input.label.trim();
  }
  if (input.is_required !== undefined) {
    if (typeof input.is_required !== "boolean")
      return fail("Некорректное обязательное поле");
    update.is_required = input.is_required;
  }
  if (input.is_active !== undefined) {
    if (typeof input.is_active !== "boolean")
      return fail("Некорректное состояние");
    update.is_active = input.is_active;
  }
  if (input.options !== undefined && existing.data.field_type !== "select")
    return fail("Варианты доступны только для полей-списков");
  if (input.options !== undefined) {
    const values = list(input.options);
    if (!values) return fail("Некорректные варианты");
    update.options = values;
  }
  if (!Object.keys(update).length) return fail("Нет изменений");
  const result = await supabase
    .from("custom_field_defs")
    .update(update)
    .eq("id", input.id)
    .select("*")
    .single();
  if (result.error || !result.data) return fail("Не удалось сохранить поле");
  return NextResponse.json({ field: result.data });
}

export async function DELETE(request: Request) {
  const profile = await admin();
  const input = await read(request);
  if (!profile) return fail("Недостаточно прав", 403);
  if (
    !input ||
    !isUuid(input.id) ||
    input.confirm !== true ||
    typeof input.filled !== "number" ||
    !Number.isInteger(input.filled) ||
    input.filled < 0
  )
    return fail("Требуется явное подтверждение текущего количества");
  const supabase = await createClient();
  const current = await supabase
    .from("custom_field_values")
    .select("entity_id", { count: "exact", head: true })
    .eq("field_id", input.id)
    .not("value", "is", null);
  if (current.error) return fail("Не удалось проверить заполненность");
  if ((current.count ?? 0) !== input.filled)
    return fail(
      "Количество заполненных значений изменилось; обновите экран",
      409,
    );
  const result = await supabase
    .from("custom_field_defs")
    .delete()
    .eq("id", input.id)
    .select("id")
    .single();
  if (result.error || !result.data) return fail("Не удалось удалить поле");
  return NextResponse.json({ id: result.data.id });
}
