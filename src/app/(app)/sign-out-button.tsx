"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useNavCollapsed } from "./nav-collapse";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const navCollapsed = useNavCollapsed();

  async function handleSignOut() {
    if (pending) return;
    setPending(true);
    const supabase = createClient();
    try {
      await supabase.auth.signOut();
      router.push("/login");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={pending}
      className="btn-ghost nav-signout"
      title={navCollapsed ? "Выйти" : undefined}
    >
      <LogOut size={14} aria-hidden="true" />
      <span className="nav-label">{pending ? "Выходим…" : "Выйти"}</span>
    </button>
  );
}
