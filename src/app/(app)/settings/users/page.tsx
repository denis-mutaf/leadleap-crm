import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Profile } from "@/lib/types";
import UsersClient from "./users-client";

export default async function UsersPage() {
  const current = await getCurrentProfile();
  if (!current) redirect("/login");
  if (current.role === "manager") redirect("/deals");
  if (current.role === "builder") redirect("/reports");

  const admin = createAdminClient();
  const [
    { data: profiles, error: profileError },
    { data: authUsers, error: authError },
    { data: deals, error: dealError },
  ] = await Promise.all([
    admin
      .from("profiles")
      .select("id, full_name, role, is_active, created_at")
      .order("full_name"),
    admin.auth.admin.listUsers({ perPage: 1000 }),
    admin.from("deals").select("owner_id"),
  ]);
  if (profileError) throw new Error(`Пользователи: ${profileError.message}`);
  if (authError) throw new Error(`Почты пользователей: ${authError.message}`);
  if (dealError) throw new Error(`Сделки пользователей: ${dealError.message}`);

  const emails = new Map(
    (authUsers?.users ?? []).map((user) => [
      user.id,
      { email: user.email ?? "", lastSignIn: user.last_sign_in_at },
    ]),
  );
  const counts = new Map<string, number>();
  for (const deal of deals ?? [])
    if (deal.owner_id)
      counts.set(deal.owner_id, (counts.get(deal.owner_id) ?? 0) + 1);
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
      currentUserId={current.id}
      canEdit={current.role === "admin"}
      rows={rows}
    />
  );
}
