import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Json = Record<string, unknown>;
type SourceUser = {
  amo_id: number;
  email: string;
  full_name: string;
  role: "admin" | "manager";
  is_active: true;
};
type AuthUser = {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
};
type Profile = {
  id: string;
  amo_id: number | null;
  full_name: string;
  role: string;
  is_active: boolean;
};

const EXPECTED = 5;
const PAGE = 1000;

function fail(message: string): never {
  throw new Error(message);
}
function object(value: unknown): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}
function id(value: unknown): number {
  const result =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : NaN;
  if (!Number.isSafeInteger(result)) fail("invalid user id");
  return result;
}
function email(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || !value.includes("@"))
    fail("invalid user email");
  return value.trim().toLowerCase();
}
function name(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) fail("invalid user name");
  return value.trim();
}
function envFile(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => line && !line.trim().startsWith("#"))
      .flatMap((line) => {
        const i = line.indexOf("=");
        return i > 0
          ? [
              [
                line.slice(0, i).trim(),
                line
                  .slice(i + 1)
                  .trim()
                  .replace(/^(?:'|\")(.*)(?:'|\")$/, "$1"),
              ],
            ]
          : [];
      }),
  );
}
async function loadEnv(): Promise<Record<string, string | undefined>> {
  try {
    return {
      ...envFile(await readFile(join(process.cwd(), ".env.local"), "utf8")),
      ...process.env,
    };
  } catch {
    return process.env;
  }
}
async function sourceRows(db: SupabaseClient): Promise<SourceUser[]> {
  const rows: SourceUser[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("amo_import_records")
      .select("amo_id,payload")
      .eq("entity_type", "user")
      .order("amo_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) fail(`source read failed:${error.code ?? "unknown"}`);
    const page = (data ?? []) as unknown as Array<{
      amo_id: string;
      payload: Json;
    }>;
    for (const row of page) {
      const payload = object(row.payload),
        rights = object(payload.rights);
      if (rights.is_active !== true) fail("source user is inactive");
      rows.push({
        amo_id: id(row.amo_id),
        email: email(payload.email),
        full_name: name(payload.name),
        role: rights.is_admin === true ? "admin" : "manager",
        is_active: true,
      });
    }
    if (page.length < PAGE) break;
  }
  if (rows.length !== EXPECTED) fail("expected exactly five source users");
  const ids = new Set(rows.map((row) => row.amo_id)),
    emails = new Set(rows.map((row) => row.email));
  if (ids.size !== EXPECTED) fail("duplicate source user IDs");
  if (emails.size !== EXPECTED) fail("duplicate normalized source emails");
  if (
    rows.filter((row) => row.role === "admin").length !== 1 ||
    rows.filter((row) => row.role === "manager").length !== 4
  )
    fail("source role counts mismatch");
  return rows;
}
async function authUsers(db: SupabaseClient): Promise<AuthUser[]> {
  const users: AuthUser[] = [];
  for (let page = 1; ; page++) {
    const result = await db.auth.admin.listUsers({ page, perPage: PAGE });
    if (result.error)
      fail(`auth list failed:${result.error.status ?? "unknown"}`);
    users.push(...(result.data.users as AuthUser[]));
    if (result.data.users.length < PAGE) break;
  }
  return users;
}
async function profiles(db: SupabaseClient): Promise<Profile[]> {
  const { data, error } = await db
    .from("profiles")
    .select("id,amo_id,full_name,role,is_active");
  if (error) fail(`profile read failed:${error.code ?? "unknown"}`);
  return (data ?? []) as Profile[];
}
async function main() {
  const args = process.argv.slice(2),
    write = args.includes("--write");
  if (args.some((arg) => arg !== "--write")) fail("unknown flag");
  const env = await loadEnv(),
    url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL,
    key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail("missing Supabase service-role environment");
  const db = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const users = await sourceRows(db);
  if (!write) {
    console.log(
      JSON.stringify({
        mode: "dry-run",
        users: EXPECTED,
        admins: 1,
        managers: 4,
        active: EXPECTED,
      }),
    );
    return;
  }
  const existingAuth = await authUsers(db),
    authByEmail = new Map(
      existingAuth.flatMap((user) =>
        user.email ? ([[user.email.toLowerCase(), user]] as const) : [],
      ),
    );
  const existingProfiles = await profiles(db),
    profileByAmo = new Map(
      existingProfiles.flatMap((profile) =>
        profile.amo_id === null ? [] : [[profile.amo_id, profile] as const],
      ),
    ),
    profileById = new Map(
      existingProfiles.map((profile) => [profile.id, profile]),
    );
  for (const user of users) {
    const profile = profileByAmo.get(user.amo_id),
      auth = authByEmail.get(user.email);
    if (auth) {
      const metadataAmoId = auth.user_metadata?.amo_id;
      const metadataMatches = Number(metadataAmoId) === user.amo_id;
      const authProfile = profileById.get(auth.id);
      const profileMatches =
        (!authProfile ||
          authProfile.amo_id === null ||
          authProfile.amo_id === user.amo_id) &&
        (!profile || profile.id === auth.id);
      if (!metadataMatches || !profileMatches)
        fail("source email conflicts with an unrelated auth user");
    }
  }
  for (const user of users) {
    const profile = profileByAmo.get(user.amo_id);
    let auth = profile
      ? existingAuth.find((candidate) => candidate.id === profile.id)
      : authByEmail.get(user.email);
    if (profile && !auth) fail("Amo profile has no matching auth user");
    if (auth) {
      if (auth.email?.toLowerCase() !== user.email)
        fail("existing Amo profile email mismatch");
      const currentMetadata = auth.user_metadata ?? {};
      const updated = await db.auth.admin.updateUserById(auth.id, {
        user_metadata: {
          ...currentMetadata,
          amo_id: user.amo_id,
          full_name: user.full_name,
          role: user.role,
        },
      });
      if (updated.error)
        fail(`auth update failed:${updated.error.status ?? "unknown"}`);
    } else {
      const created = await db.auth.admin.createUser({
        email: user.email,
        email_confirm: true,
        user_metadata: {
          amo_id: user.amo_id,
          full_name: user.full_name,
          role: user.role,
        },
      });
      if (created.error || !created.data.user)
        fail(`auth create failed:${created.error?.status ?? "unknown"}`);
      auth = created.data.user as AuthUser;
    }
    const updatedProfile = await db.from("profiles").upsert(
      {
        id: auth.id,
        amo_id: user.amo_id,
        full_name: user.full_name,
        role: user.role,
        is_active: true,
      },
      { onConflict: "id" },
    );
    if (updatedProfile.error)
      fail(`profile upsert failed:${updatedProfile.error.code ?? "unknown"}`);
  }
  const final = (await profiles(db)).filter(
    (profile): profile is Profile & { amo_id: number } =>
      profile.amo_id !== null,
  );
  const finalIds = new Set(final.map((profile) => profile.amo_id));
  const sourceIds = new Set(users.map((user) => user.amo_id));
  if (
    final.length !== EXPECTED ||
    finalIds.size !== EXPECTED ||
    finalIds.size !== sourceIds.size ||
    [...sourceIds].some((amoId) => !finalIds.has(amoId)) ||
    final.filter((profile) => profile.role === "admin").length !== 1 ||
    final.filter((profile) => profile.role === "manager").length !== 4 ||
    final.some((profile) => !profile.is_active)
  )
    fail("final profile verification failed");
  console.log(
    JSON.stringify({
      mode: "write",
      users: EXPECTED,
      admins: 1,
      managers: 4,
      active: EXPECTED,
    }),
  );
}
main().catch((error: unknown) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : "unknown"}`);
  process.exitCode = 1;
});
