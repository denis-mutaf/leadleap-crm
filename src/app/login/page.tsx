"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";

function humanError(message: string): string {
  if (message.includes("Invalid login credentials")) {
    return "Неверная почта или пароль. Проверьте данные и попробуйте ещё раз.";
  }
  if (message.includes("Email not confirmed")) {
    return "Почта не подтверждена. Обратитесь к руководителю.";
  }
  if (message.includes("Too many requests")) {
    return "Слишком много попыток. Подождите немного и попробуйте ещё раз.";
  }
  if (message.includes("Failed to fetch") || message.includes("fetch")) {
    return "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.";
  }
  return "Не удалось войти. Проверьте данные и попробуйте ещё раз.";
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError("Введите почту и пароль.");
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { data: signInData, error: signInError } =
        await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

      if (signInError) {
        setError(humanError(signInError.message));
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role, is_active")
        .eq("id", signInData.user.id)
        .maybeSingle();

      if (profileError || !profile) {
        await supabase.auth.signOut();
        setError("Не удалось проверить учётную запись. Попробуйте ещё раз.");
        return;
      }

      if (!profile.is_active) {
        await supabase.auth.signOut();
        setError("Учётная запись отключена. Обратитесь к руководителю.");
        return;
      }

      router.push(profile.role === "builder" ? "/reports" : "/deals");
      router.refresh();
    } catch {
      setError(
        "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4" style={{ background: "var(--page)" }}>
      <div className="module motion-dialog w-full max-w-sm" style={{ borderRadius: 28, padding: 28 }}>
        <Image src="/brand/logo.svg" alt="ISRAGRUP" width={120} height={28} />
        <h1 className="mt-4 text-xl font-medium" style={{ color: "var(--foreground)" }}>Вход в CRM</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--secondary-text)" }}>
          Сотрудников заводит руководитель. Регистрации здесь нет.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="email"
              className="mb-1 block text-sm font-medium"
              style={{ color: "var(--secondary-text)" }}
            >
              Почта
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              className="input w-full"
              placeholder="manager@example.com"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-sm font-medium"
              style={{ color: "var(--secondary-text)" }}
            >
              Пароль
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              className="input w-full"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p role="alert" className="motion-fade-up text-sm" style={{ color: "var(--destructive)" }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary w-full"
          >
            {loading ? "Входим…" : "Войти"}
          </button>
        </form>
      </div>
    </div>
  );
}
