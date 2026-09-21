import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { getCurrentProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Profile } from "@/lib/types";
import UsersClient from "./users-client";

const PAGE_SIZE = 1000;

async function loadAllProfiles(admin: ReturnType<typeof createAdminClient>) {
  const profiles: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("profiles")
      .select("id, full_name, role, is_active, created_at")
      .order("full_name")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error("Не удалось загрузить профили пользователей");
    profiles.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return profiles;
  }
}

async function loadAllAuthUsers(admin: ReturnType<typeof createAdminClient>) {
  const users: User[] = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: PAGE_SIZE,
    });
    if (error)
      throw new Error("Не удалось загрузить данные входа пользователей");
    users.push(...data.users);
    if (data.users.length < PAGE_SIZE) return users;
  }
}

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
) {
  const results: R[] = [];
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

export default async function UsersPage() {
  const current = await getCurrentProfile();
  if (!current) redirect("/login");
  if (current.role === "manager") redirect("/deals");
  if (current.role === "builder") redirect("/reports");

  const admin = createAdminClient();
  const [profiles, authUsers] = await Promise.all([
    loadAllProfiles(admin),
    loadAllAuthUsers(admin),
  ]);

  const emails = new Map(
    authUsers.map((user) => [
      user.id,
      { email: user.email ?? "", lastSignIn: user.last_sign_in_at },
    ]),
  );
  const counts = new Map<string, number>();
  const countResults = await mapWithLimit(profiles, 4, async (profile) => {
    const { count, error } = await admin
      .from("deals")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", String(profile.id));
    if (error || count === null)
      throw new Error("Не удалось посчитать сделки пользователей");
    return [String(profile.id), count] as const;
  });
  for (const [id, count] of countResults) counts.set(id, count);
  const rows = (
    profiles as Pick<
      Profile,
      "id" | "full_name" | "role" | "is_active" | "created_at"
    >[]
  ).map((profile) => ({
    ...profile,
    email: emails.get(profile.id)?.email ?? "—",
    lastSignIn: emails.get(profile.id)?.lastSignIn ?? null,
    dealCount: counts.get(profile.id) ?? 0,
  }));

  return (
    <UsersClient
      key={rows
        .map((row) => `${row.id}:${row.role}:${row.is_active}`)
        .join("|")}
      currentUserId={current.id}
      canEdit={current.role === "admin"}
      rows={rows}
    />
  );
}
