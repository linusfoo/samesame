/**
 * Daily budget for the free tiers of Firecrawl, Jina Reader and Browser Rendering.
 *
 * Per-run caps stop one agent from looping; this counter stops many runs
 * from draining a monthly quota. Days roll over at Singapore midnight.
 *
 * New searches may use 70% of each day's limit; the rest is kept for
 * watchlist re-checks so the watchlist never misses a day.
 */

export type Tool = "firecrawl" | "jina" | "browser";
export type Usage = Record<Tool, number>;
export type QuotaState = { day: string; used: Usage };
export type Purpose = "search" | "watch";

// Firecrawl's free account has 1,000 credits a month (a search costs about 2,
// a page scrape 1); 30 calls a day fits a month of typical use, and when the
// credits run out Firecrawl refuses rather than charging. Jina Reader without
// a key allows about 20 pages a minute; its cap only stops runaway use.
// Browser Rendering's free plan is 10 minutes a day.
export const DAILY_LIMITS: Usage = { firecrawl: 30, jina: 100, browser: 20 };

/** Share of each daily limit that new searches may use. */
export const SEARCH_SHARE = 0.7;

const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;
const TOOLS: Tool[] = ["firecrawl", "jina", "browser"];

export function sgDay(now: Date): string {
  return new Date(now.getTime() + SGT_OFFSET_MS).toISOString().slice(0, 10);
}

export function emptyQuota(now: Date): QuotaState {
  return { day: sgDay(now), used: { firecrawl: 0, jina: 0, browser: 0 } };
}

/** The state for today, resetting the counts when the day or the set of tools has changed. */
export function currentQuota(state: QuotaState | null, now: Date): QuotaState {
  if (!state || state.day !== sgDay(now)) return emptyQuota(now);
  if (!TOOLS.every((t) => typeof state.used?.[t] === "number")) return emptyQuota(now);
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

/** Tool calls one sub-agent run may make (kept equal to the agent loop's cap). */
export const DEFAULT_CALLS_PER_RUN = 6;

/** Full agent runs today's searches can still pay for, counting every call as a search. */
export function affordableRuns(left: Usage, callsPerRun: number = DEFAULT_CALLS_PER_RUN): number {
  return Math.floor(left.firecrawl / callsPerRun);
}

export function consume(state: QuotaState, tool: Tool): QuotaState {
  return { ...state, used: { ...state.used, [tool]: state.used[tool] + 1 } };
}
