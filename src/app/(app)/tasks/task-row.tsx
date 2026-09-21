"use client";

import {
  CalendarDays,
  CheckCircle2,
  FileText,
  MessageCircle,
  Phone,
  Presentation,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { StageIndicator } from "@/components/crm/stage-indicator";
import { TaskCompletion } from "./task-completion";

const icons = {
  call: Phone,
  meeting: Users,
  presentation: Presentation,
  message: MessageCircle,
  documents: FileText,
} as const;

export function TaskRow({
  task,
  actorId,
}: {
  task: {
    id: string;
    deal_id: string | null;
    title: string | null;
    typeCode?: string | null;
    typeName: string;
    contactName: string;
    stageName: string;
    stage: { id: string; kind: "open" | "won" | "lost"; position: number } | null;
    allStages: { id: string; kind: "open" | "won" | "lost"; position: number }[];
    assigneeName: string;
    dueLabel: string;
    overdueLabel?: string;
    done_at: string | null;
    result_text?: string | null;
  };
  actorId: string;
}) {
  const router = useRouter();
  const Icon = icons[task.typeCode as keyof typeof icons] ?? CalendarDays;
  const title = task.title?.trim() || `${task.typeName} — без названия`;
  const openDeal = () => {
    router.push(task.deal_id ? `/deals/${task.deal_id}` : "/tasks");
  };

  return (
    <div className="task-row-wrap">
      <div
        className={`task-row ${task.done_at ? "is-done" : ""}`}
        role="link"
        tabIndex={0}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("button, a")) return;
          openDeal();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openDeal();
          }
        }}
      >
      {task.done_at ? (
        <span className="task-check is-complete" aria-label="Задача выполнена">
          <CheckCircle2 size={15} />
        </span>
      ) : (
        <TaskCompletion taskId={task.id} actorId={actorId} />
      )}
      <span className="task-type" title={task.typeName}>
        <Icon size={14} />
      </span>
      <span className="task-main">
        <strong>{title}</strong>
        <span>
          {task.deal_id ? (
            <a href={`/deals/${task.deal_id}`}>{task.contactName}</a>
          ) : (
            task.contactName
          )}
          <em>·</em>
          {task.stage ? (
            <StageIndicator
              stage={task.stage}
              stages={task.allStages}
              name={task.stageName}
              variant="inline"
            />
          ) : (
            task.stageName
          )}
        </span>
      </span>
      <span
        className={`task-due ${task.overdueLabel ? "is-overdue" : ""}`}
      >
        {task.overdueLabel ?? task.dueLabel}
      </span>
      <span className="task-avatar" title={task.assigneeName}>
        {task.assigneeName
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((part) => part[0])
          .join("")
          .toUpperCase() || "—"}
      </span>
      </div>
      {task.done_at && task.result_text && (
        <div className="task-result">
          <CheckCircle2 size={14} /> {task.result_text}
        </div>
      )}
    </div>
  );
}
