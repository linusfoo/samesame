/**
 * Daily budget for the free tiers of Brave, Tavily and Browser Rendering.
 *
 * Per-run caps stop one agent from looping; this counter stops many runs
 * from draining a monthly quota. Days roll over at Singapore midnight.
 */

export type Tool = "brave" | "tavily" | "browser";
export type Usage = Record<Tool, number>;
export type QuotaState = { day: string; used: Usage };

// Roughly the monthly free tier divided by 30, with headroom.
export const DAILY_LIMITS: Usage = { brave: 60, tavily: 30, browser: 20 };

const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

export function sgDay(now: Date): string {
  return new Date(now.getTime() + SGT_OFFSET_MS).toISOString().slice(0, 10);
}

export function emptyQuota(now: Date): QuotaState {
  return { day: sgDay(now), used: { brave: 0, tavily: 0, browser: 0 } };
}

/** The state for today, resetting the counts when the day has changed. */
export function currentQuota(state: QuotaState | null, now: Date): QuotaState {
  if (!state || state.day !== sgDay(now)) return emptyQuota(now);
  return state;
}

export function remaining(state: QuotaState, limits: Usage = DAILY_LIMITS): Usage {
  return {
    brave: Math.max(0, limits.brave - state.used.brave),
    tavily: Math.max(0, limits.tavily - state.used.tavily),
    browser: Math.max(0, limits.browser - state.used.browser),
  };
}

export function canUse(state: QuotaState, tool: Tool, limits: Usage = DAILY_LIMITS): boolean {
  return state.used[tool] < limits[tool];
}

export function consume(state: QuotaState, tool: Tool): QuotaState {
  return { ...state, used: { ...state.used, [tool]: state.used[tool] + 1 } };
}
