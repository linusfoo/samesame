/**
 * Daily budget for the free tiers of Brave, Tavily and Browser Rendering.
 *
 * Per-run caps stop one agent from looping; this counter stops many runs
 * from draining a monthly quota. Days roll over at Singapore midnight.
 *
 * New searches may use 70% of each day's limit; the rest is kept for
 * watchlist re-checks so the watchlist never misses a day.
 */

export type Tool = "brave" | "tavily" | "browser";
export type Usage = Record<Tool, number>;
export type QuotaState = { day: string; used: Usage };
export type Purpose = "search" | "watch";

// Roughly the monthly free tier divided by 30, with headroom.
export const DAILY_LIMITS: Usage = { brave: 60, tavily: 30, browser: 20 };

/** Share of each daily limit that new searches may use. */
export const SEARCH_SHARE = 0.7;

const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;
const TOOLS: Tool[] = ["brave", "tavily", "browser"];

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

/** How many calls of a tool this purpose may use in a day. */
export function limitFor(tool: Tool, purpose: Purpose, limits: Usage = DAILY_LIMITS): number {
  return purpose === "search" ? Math.floor(limits[tool] * SEARCH_SHARE) : limits[tool];
}

/** Calls left today for a purpose (by default, new searches). */
export function remaining(state: QuotaState, purpose: Purpose = "search", limits: Usage = DAILY_LIMITS): Usage {
  const left = (tool: Tool) => Math.max(0, limitFor(tool, purpose, limits) - state.used[tool]);
  return Object.fromEntries(TOOLS.map((t) => [t, left(t)])) as Usage;
}

export function canUse(state: QuotaState, tool: Tool, purpose: Purpose = "search", limits: Usage = DAILY_LIMITS): boolean {
  return state.used[tool] < limitFor(tool, purpose, limits);
}

export function consume(state: QuotaState, tool: Tool): QuotaState {
  return { ...state, used: { ...state.used, [tool]: state.used[tool] + 1 } };
}
