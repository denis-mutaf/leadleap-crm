"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { AuthShell } from "@/components/crm/auth-shell";
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
  const [showPassword, setShowPassword] = useState(false);

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
    <AuthShell>
      <h1>Вход в CRM</h1>
      <p className="auth-lead">Почта и пароль, которые выдал руководитель.</p>

      <form onSubmit={handleSubmit} className="auth-fields" noValidate>
        <div className="auth-field">
          <label htmlFor="email">Почта</label>
          <div className="auth-control">
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              placeholder="name@gmail.com"
            />
          </div>
        </div>

        <div className="auth-field">
          <label htmlFor="password">Пароль</label>
          <div className="auth-control">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              placeholder="Пароль"
            />
            <button
              type="button"
              className="auth-eye"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
              aria-pressed={showPassword}
            >
              {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
            </button>
          </div>
        </div>

        {error && (
          <p role="alert" className="auth-error motion-fade-up">
            {error}
          </p>
        )}

        <button type="submit" disabled={loading} className="btn btn-primary auth-submit">
          {loading ? "Входим…" : "Войти"}
        </button>
      </form>

      <p className="auth-foot">Нет доступа? Попросите руководителя прислать приглашение.</p>
    </AuthShell>
  );
}
