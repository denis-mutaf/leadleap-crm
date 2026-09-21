import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import TrashClient, { type TrashRow } from "./trash-client";

const entities = ["deals", "contacts", "notes", "tasks"] as const;
export default async function TrashPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; page?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role === "builder") redirect("/reports");
  const params = await searchParams;
  const entity = entities.includes(params.entity as never)
    ? params.entity!
    : "all";
  const page = Math.max(
    1,
    Math.min(10000, Number.parseInt(params.page ?? "1", 10) || 1),
  );
  const limit = 25;
  const client = await createClient();
  async function load(requestedPage: number) {
    return client.rpc("list_crm_trash", {
      p_entity: entity === "all" ? null : entity,
      p_limit: limit,
      p_offset: (requestedPage - 1) * limit,
    });
  }
  let result = await load(page);
  if (result.error) throw new Error("Не удалось загрузить корзину");
  const payload = result.data as unknown;
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("Некорректный ответ корзины");
  const raw = payload as { total?: unknown; rows?: unknown };
  const total =
    Number.isSafeInteger(raw.total) && (raw.total as number) >= 0
      ? (raw.total as number)
      : null;
  if (total === null) throw new Error("Некорректное количество записей");
  const lastPage = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, lastPage);
  if (safePage !== page) {
    result = await load(safePage);
    if (result.error) throw new Error("Не удалось загрузить корзину");
  }
  const finalPayload = result.data as { total?: unknown; rows?: unknown };
  if (
    !finalPayload ||
    typeof finalPayload !== "object" ||
    !Array.isArray(finalPayload.rows)
  )
    throw new Error("Некорректные данные корзины");
  const rows = finalPayload.rows.filter(
    (row): row is TrashRow =>
      row !== null &&
      typeof row === "object" &&
      ["deals", "contacts", "notes", "tasks"].includes(
        (row as Record<string, unknown>).entity as never,
      ) &&
      typeof (row as Record<string, unknown>).id === "string" &&
      /^[0-9a-f-]{36}$/i.test((row as Record<string, unknown>).id as string) &&
      typeof (row as Record<string, unknown>).label === "string" &&
      typeof (row as Record<string, unknown>).deleted_at === "string" &&
      typeof (row as Record<string, unknown>).deleted_by === "string" &&
      ((row as Record<string, unknown>).deleted_by_name === null ||
        typeof (row as Record<string, unknown>).deleted_by_name === "string"),
  );
  const asOf = new Date().toISOString();
  return (
    <TrashClient
      key={`${entity}:${safePage}`}
      rows={rows}
      total={total}
      page={safePage}
      limit={limit}
      entity={entity}
      canRestore
      asOf={asOf}
    />
  );
}
