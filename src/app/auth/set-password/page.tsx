"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { dbErrorText } from "@/lib/db-errors";
import { AuthShell } from "@/components/crm/auth-shell";

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
    <AuthShell>
      <h1>{mode === "recovery" ? "Новый пароль" : "Добро пожаловать"}</h1>
      <p className="auth-lead">
        {mode === "recovery"
          ? "Придумайте новый пароль для входа."
          : "Придумайте пароль — с ним вы будете входить в CRM."}
      </p>

      {!ready ? (
        <p className="auth-lead" role="status">Проверяем ссылку…</p>
      ) : linkError ? (
        <p role="alert" className="auth-error motion-fade-up">
          {linkError}
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="auth-fields" noValidate>
          <div className="auth-field">
            <label htmlFor="password">Новый пароль</label>
            <div className="auth-control">
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                placeholder="Не короче 8 символов"
              />
            </div>
            {passwordHint && <p className="auth-hint">{passwordHint}</p>}
          </div>

          <div className="auth-field">
            <label htmlFor="confirm">Повторите пароль</label>
            <div className="auth-control">
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={loading}
                placeholder="Ещё раз"
              />
            </div>
            {confirmHint && <p className="auth-hint">{confirmHint}</p>}
          </div>

          {error && (
            <p role="alert" className="auth-error motion-fade-up">
              {error}
            </p>
          )}

          <button type="submit" disabled={!canSubmit} className="btn btn-primary auth-submit">
            {loading ? "Сохраняем…" : "Сохранить и войти"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
