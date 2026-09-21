import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import {
  stageHue,
  stageHueVars,
  type StageHue,
} from "@/lib/stage-colors";
import type { Stage } from "@/lib/types";

type StageLike = Pick<Stage, "id" | "kind" | "position">;

export type StageIndicatorVariant = "dot" | "inline" | "chip" | "track";

interface StageIndicatorProps {
  /** Прямой тон. Если задан stage — hue вычисляется из него, hue игнорируется. */
  hue?: StageHue;
  /** Этап; hue выводится из kind + порядка через stageHue(). */
  stage?: StageLike;
  /** Все этапы справочника — нужны stageHue() для порядкового индекса открытых. */
  stages?: readonly StageLike[];
  /** Подпись рядом/внутри. */
  name?: string;
  variant?: StageIndicatorVariant;
  /** Только для variant="track": доля заливки 0..1. */
  fillRatio?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Единый примитив подачи этапа: точка, связка «точка + название» (.st),
 * цветной чип или track/fill для воронки отчётов.
 * Цвета — только из stageHue()/hue-токенов, названий этапов здесь нет.
 */
export function StageIndicator({
  hue,
  stage,
  stages,
  name,
  variant = "inline",
  fillRatio = 0,
  className,
  style,
}: StageIndicatorProps) {
  const resolved: StageHue = stage ? stageHue(stage, stages) : (hue ?? "grey");
  const vars = stageHueVars(resolved);

  if (variant === "dot") {
    return (
      <span
        aria-hidden="true"
        className={cn("dot", className)}
        style={{ marginTop: 0, background: vars.dot, ...style }}
      />
    );
  }

  if (variant === "chip") {
    return (
      <span
        className={cn("tag", className)}
        style={{ background: vars.bg, color: vars.text, ...style }}
      >
        {name}
      </span>
    );
  }

  if (variant === "track") {
    const ratio = Number.isFinite(fillRatio)
      ? Math.min(1, Math.max(0, fillRatio))
      : 0;
    return (
      <span
        role="img"
        aria-label={name ?? `Заполнено ${Math.round(ratio * 100)}%`}
        className={cn("stage-indicator-track", className)}
        style={{
          display: "block",
          height: 20,
          minWidth: 0,
          overflow: "hidden",
          borderRadius: "var(--radius)",
          background: vars.bg,
          ...style,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: "block",
            height: "100%",
            minWidth: ratio > 0 ? 20 : 0,
            width: `${ratio * 100}%`,
            borderRadius: "var(--radius)",
            background: vars.dot,
          }}
        />
      </span>
    );
  }

  // "inline" — этап как связка «точка + название» (.st из кита).
  return (
    <span className={cn("st", className)} style={style}>
      <span
        aria-hidden="true"
        className="dot"
        style={{ marginTop: 0, background: vars.dot }}
      />
      {name != null && <span className="tr">{name}</span>}
    </span>
  );
}
