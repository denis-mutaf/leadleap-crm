"use client";

import { useState } from "react";
import { Phone } from "lucide-react";
import { toast } from "sonner";
import { dbErrorText } from "@/lib/db-errors";
import styles from "./calls.module.css";

export function CallbackButton({ callId }: { callId: string }) {
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      className={styles.iconBtn}
      title="Перезвонить"
      aria-label="Перезвонить"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          const res = await fetch("/api/calls/callback", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ callId }),
          });
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          if (!res.ok) throw new Error(body?.error ?? "АТС не ответила");
          toast.success("Звоним: сначала поднимется ваша трубка");
        } catch (err) {
          toast.error(dbErrorText(err, "Не удалось позвонить"));
        } finally {
          setPending(false);
        }
      }}
    >
      <Phone size={15} aria-hidden="true" />
    </button>
  );
}
