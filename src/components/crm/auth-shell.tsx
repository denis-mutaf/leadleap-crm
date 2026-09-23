import Image from "next/image";
import type { ReactNode } from "react";

// Экран входа и смены пароля: слева арт в цветах ДС (графит, лайм,
// чертёжная сетка — мы застройщик), справа форма. На телефоне арт уходит,
// логотип встаёт над формой.
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-frame motion-dialog">
        <aside className="auth-art" aria-hidden="true">
          <span className="auth-art-glow" />
          <Image className="auth-art-logo" src="/brand/logo.svg" alt="" width={132} height={31} priority />
          <div className="auth-art-copy">
            <span>CRM отдела продаж</span>
            <p>Заявки, звонки и сделки — в одном окне</p>
          </div>
        </aside>
        <main className="auth-form">
          <Image className="auth-form-logo" src="/brand/logo.svg" alt="ISRAGRUP" width={120} height={28} priority />
          {children}
        </main>
      </div>
    </div>
  );
}
