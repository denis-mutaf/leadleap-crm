import type { Stage } from "./types";

/**
 * Единая карта цветов этапов (Attio-редизайн, 21.09.2026).
 * Эталон: design/screens/_kit.css (hue-токены), deals-pipeline.html,
 * reports.html, settings.html.
 *
 * Правила:
 * - открытые этапы — по порядку сортировки (position): cyan, violet, blue,
 *   grey, amber, olive, pink, magenta, cyan, amber; дальше по кругу;
 * - закрытые: won → green, lost → red;
 * - названия этапов НЕ хардкодятся — только kind + порядок;
 * - «Заинтересован в новом объекте» (amo status 77928582) — обычный открытый
 *   этап со своим местом в порядке, без подмен полем Проект.
 */

export type StageHue =
  | "cyan"
  | "violet"
  | "blue"
  | "grey"
  | "amber"
  | "olive"
  | "pink"
  | "magenta"
  | "green"
  | "red";

export const OPEN_STAGE_HUES: readonly StageHue[] = [
  "cyan",
  "violet",
  "blue",
  "grey",
  "amber",
  "olive",
  "pink",
  "magenta",
  "cyan",
  "amber",
];

export const WON_STAGE_HUE: StageHue = "green";
export const LOST_STAGE_HUE: StageHue = "red";

type StageLike = Pick<Stage, "id" | "kind" | "position">;

/** Hue одного открытого этапа по его индексу среди открытых (0-based). */
export function openStageHueByIndex(index: number): StageHue {
  const i = ((Math.trunc(index) % OPEN_STAGE_HUES.length) + OPEN_STAGE_HUES.length) % OPEN_STAGE_HUES.length;
  return OPEN_STAGE_HUES[i] ?? "grey";
}

/**
 * Hue произвольного этапа. Для открытых нужен список всех этапов (или хотя бы
 * открытых), чтобы вычислить порядковый индекс по position. Без списка —
 * фолбэк grey, никакого гадания по названию.
 */
export function stageHue(stage: StageLike, allStages?: readonly StageLike[]): StageHue {
  if (stage.kind === "won") return WON_STAGE_HUE;
  if (stage.kind === "lost") return LOST_STAGE_HUE;
  if (!allStages) return "grey";
  const open = [...allStages]
    .filter((s) => s.kind === "open")
    .sort((a, b) => a.position - b.position);
  const index = open.findIndex((s) => s.id === stage.id);
  if (index < 0) return "grey";
  return openStageHueByIndex(index);
}

/** Карта stage.id → hue для всего справочника этапов. */
export function buildStageHueMap(stages: readonly StageLike[]): Map<string, StageHue> {
  const map = new Map<string, StageHue>();
  const open = [...stages]
    .filter((s) => s.kind === "open")
    .sort((a, b) => a.position - b.position);
  const openIndex = new Map(open.map((stage, index) => [stage.id, index]));
  for (const s of stages) {
    if (s.kind === "won") {
      map.set(s.id, WON_STAGE_HUE);
    } else if (s.kind === "lost") {
      map.set(s.id, LOST_STAGE_HUE);
    } else {
      const index = openIndex.get(s.id);
      map.set(s.id, index == null ? "grey" : openStageHueByIndex(index));
    }
  }
  return map;
}

/** CSS-переменные тона для инлайн-стилей. У magenta нет bg/tx в замере — фолбэк. */
export function stageHueVars(hue: StageHue) {
  return {
    dot: `var(--hue-${hue}-dot)`,
    bg: `var(--hue-${hue}-bg, var(--muted))`,
    text: `var(--hue-${hue}-tx, var(--secondary-text, #606164))`,
  } as const;
}
