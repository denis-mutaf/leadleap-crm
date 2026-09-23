"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { dbErrorText } from "@/lib/db-errors";

const EXPIRED_LINK =
  "Ссылка устарела или уже использована. Попросите администратора прислать приглашение заново.";

export default function SetPasswordPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"invite" | "recovery">("invite");
  const [ready, setReady] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;
      const params = new URLSearchParams(hash);
      const errorDescription = params.get("error_description");
      if (errorDescription) {
        setLinkError(EXPIRED_LINK);
        setReady(true);
        return;
      }
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      const type = params.get("type");
      if (type === "recovery" || type === "invite") {
        setMode(type);
      }
      if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        window.history.replaceState(
          null,
          "",
          window.location.pathname + window.location.search,
        );
        if (sessionError) {
          setLinkError(EXPIRED_LINK);
          setReady(true);
          return;
        }
        setReady(true);
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setReady(true);
        return;
      }
      setLinkError(EXPIRED_LINK);
      setReady(true);
    }
    void init();
  }, []);

  const passwordHint =
    password.length > 0 && password.length < 8
      ? "Минимум 8 символов."
      : null;
  const confirmHint =
    confirm.length > 0 && password !== confirm
      ? "Пароли не совпадают."
      : null;
  const canSubmit =
    password.length >= 8 && password === confirm && !loading && !linkError;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Минимум 8 символов.");
      return;
    }
    if (password !== confirm) {
      setError("Пароли не совпадают.");
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });
      if (updateError) {
        setError(dbErrorText(updateError, "Не удалось сохранить пароль. Попробуйте ещё раз."));
        return;
      }
      router.replace("/deals");
      router.refresh();
    } catch (err) {
      setError(dbErrorText(err as Error, "Не удалось сохранить пароль. Попробуйте ещё раз."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4" style={{ background: "var(--page)" }}>
      <div className="module motion-dialog w-full max-w-sm" style={{ borderRadius: 28, padding: 28 }}>
        <Image src="/brand/logo.svg" alt="ISRAGRUP" width={120} height={28} />
        <h1 className="mt-4 text-xl font-medium" style={{ color: "var(--foreground)" }}>
          {mode === "recovery" ? "Новый пароль" : "Добро пожаловать в ISRAGRUP CRM"}
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--secondary-text)" }}>
          {mode === "recovery"
            ? "Придумайте новый пароль для входа."
            : "Придумайте пароль, чтобы войти в систему."}
        </p>

        {!ready ? (
          <p className="mt-6 text-sm" style={{ color: "var(--secondary-text)" }}>
            Проверяем ссылку…
          </p>
        ) : linkError ? (
          <p role="alert" className="motion-fade-up mt-6 text-sm" style={{ color: "var(--destructive)" }}>
            {linkError}
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="password"
                className="mb-1 block text-sm font-medium"
                style={{ color: "var(--secondary-text)" }}
              >
                Новый пароль
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                className="input w-full"
                placeholder="••••••••"
              />
              {passwordHint && (
                <p className="mt-1 text-sm" style={{ color: "var(--secondary-text)" }}>
                  {passwordHint}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="confirm"
                className="mb-1 block text-sm font-medium"
                style={{ color: "var(--secondary-text)" }}
              >
                Повторите пароль
              </label>
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={loading}
                className="input w-full"
                placeholder="••••••••"
              />
              {confirmHint && (
                <p className="mt-1 text-sm" style={{ color: "var(--secondary-text)" }}>
                  {confirmHint}
                </p>
              )}
            </div>

            {error && (
              <p role="alert" className="motion-fade-up text-sm" style={{ color: "var(--destructive)" }}>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="btn btn-primary w-full"
            >
              {loading ? "Сохраняем…" : "Сохранить и войти"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
