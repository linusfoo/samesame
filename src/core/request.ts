/**
 * Checks on what the shopper sends before any agent runs: the search request
 * itself, and which category candidates to compare.
 */

import { DEFAULT_CALLS_PER_RUN, affordableRuns } from "./quota";
import type { Usage } from "./quota";

export type Mode = "model" | "category";

export type ResearchInput = {
  mode: Mode;
  query: string;
  description: string;
  priorities: string;
};

export const MAX_INPUT_CHARS = 500;

/** Most candidates compared at once in category mode. */
export const MAX_PICKS = 2;

export type Checked<T> = { ok: true; value: T } | { ok: false; reason: string };

export function parseResearchInput(raw: unknown): Checked<ResearchInput> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => String(v ?? "").trim().slice(0, MAX_INPUT_CHARS);
  const mode = r.mode ?? "model";
  if (mode !== "model" && mode !== "category") return { ok: false, reason: "choose a model or a category search" };
  const query = text(r.query);
  if (!query) return { ok: false, reason: mode === "model" ? "enter a product" : "enter a category" };
  return { ok: true, value: { mode, query, description: text(r.description), priorities: text(r.priorities) } };
}

/** Validate candidate picks and check today's search share can pay for them. */
export function checkPicks(raw: unknown, candidateCount: number, left: Usage): Checked<number[]> {
  if (!Array.isArray(raw)) return { ok: false, reason: "pick at least one product" };
  const picks = [...new Set(raw)];
  if (picks.length === 0) return { ok: false, reason: "pick at least one product" };
  if (picks.length > MAX_PICKS) return { ok: false, reason: `pick at most ${MAX_PICKS} products` };
  if (!picks.every((i) => Number.isInteger(i) && i >= 0 && i < candidateCount)) {
    return { ok: false, reason: "that product is no longer in the list" };
  }
  const affordable = affordableRuns(left, DEFAULT_CALLS_PER_RUN);
  if (affordable < picks.length) {
    return {
      ok: false,
      reason:
        affordable === 0
          ? "today's search budget is used up; try again tomorrow"
          : `today's search budget covers ${affordable} more product; pick ${affordable}`,
    };
  }
  return { ok: true, value: picks as number[] };
}
