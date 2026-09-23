"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

// Возврат выполненной задачи в работу: снимает отметку о выполнении.
// Старый результат остаётся в строке, при повторном завершении менеджер
// напишет новый.
export function TaskReopen({ taskId }: { taskId: string }) {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function reopen() {
    if (pending) return;
    setPending(true);
    const supabase = createClient();
    const update = await supabase
      .from("tasks")
      .update({ done_at: null, done_by: null })
      .eq("id", taskId)
      .select("id")
      .single();
    setPending(false);
    if (update.error) {
      toast.error("Не получилось вернуть задачу. Попробуйте ещё раз.");
      return;
    }
    toast.success("Задача снова в работе");
    router.refresh();
  }

  return (
    <button
      className="task-check"
      type="button"
      onClick={() => void reopen()}
      disabled={pending}
      aria-label="Вернуть задачу в работу"
      title="Вернуть в работу"
    >
      <RotateCcw size={15} />
    </button>
  );
}
