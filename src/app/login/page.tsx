"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
    <div className="flex min-h-screen items-center justify-center bg-zinc-100 px-4">
      <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-zinc-900">Вход в CRM</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Сотрудников заводит руководитель. Регистрации здесь нет.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="email"
              className="mb-1 block text-sm font-medium text-zinc-700"
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
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-600 focus:outline-none disabled:opacity-60"
              placeholder="manager@example.com"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-sm font-medium text-zinc-700"
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
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-600 focus:outline-none disabled:opacity-60"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none disabled:opacity-60"
          >
            {loading ? "Входим…" : "Войти"}
          </button>
        </form>
      </div>
    </div>
  );
}
