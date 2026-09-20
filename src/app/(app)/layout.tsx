import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { USER_ROLE_LABELS } from "@/lib/types";
import { SignOutButton } from "./sign-out-button";

const NAV = [
  { href: "/deals", label: "Сделки" },
  { href: "/tasks", label: "Задачи" },
  { href: "/inbox", label: "Инбокс" },
  { href: "/contacts", label: "Контакты" },
  { href: "/reports", label: "Отчёты", roles: ["head", "admin"] as const },
  { href: "/settings", label: "Настройки", roles: ["head", "admin"] as const },
];

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  const visibleNav = NAV.filter(
    (item) => !("roles" in item) || (item.roles as readonly string[]).includes(profile.role),
  );

  return (
    <div className="flex min-h-screen bg-zinc-100 text-zinc-900">
      <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-200 bg-white">
        <div className="border-b border-zinc-200 px-4 py-4">
          <p className="text-sm font-semibold">CRM застройщика</p>
        </div>
        <nav className="flex-1 space-y-1 px-2 py-4">
          {visibleNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-zinc-200 px-4 py-4">
          <p className="truncate text-sm font-medium">{profile.full_name}</p>
          <p className="text-xs text-zinc-500">{USER_ROLE_LABELS[profile.role]}</p>
          <SignOutButton />
        </div>
      </aside>
      <main className="flex-1 px-8 py-6">{children}</main>
    </div>
  );
}
