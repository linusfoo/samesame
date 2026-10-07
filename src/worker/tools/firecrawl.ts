/**
 * Firecrawl REST API (free account, no card: 1,000 credits a month).
 * Search is localised to Singapore; scrape is the second page reader when
 * Jina Reader is blocked. fetch* functions do IO; formatFirecrawlSearch is
 * pure and tested.
 */

const FIRECRAWL_URL = "https://api.firecrawl.dev/v2";
const SEARCH_TIMEOUT_MS = 30_000;
const SCRAPE_TIMEOUT_MS = 45_000;
const MAX_RESULTS = 8;

export type FirecrawlResult = { title?: string; url: string; description?: string };

export type FirecrawlSearchResponse = { data?: { web?: FirecrawlResult[] } };

type FirecrawlError = { success?: boolean; error?: string };

async function post<T>(apiKey: string, path: string, body: unknown, timeoutMs: number): Promise<T> {
  const res = await fetch(`${FIRECRAWL_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = ((await res.json().catch(() => ({}))) as FirecrawlError).error;
    if (res.status === 402) throw new Error("Firecrawl credits are used up for this month");
    throw new Error(`Firecrawl returned ${res.status}${detail ? `: ${detail.slice(0, 120)}` : ""}`);
  }
  return res.json() as Promise<T>;
}

export function fetchFirecrawlSearch(apiKey: string, query: string): Promise<FirecrawlSearchResponse> {
  return post(apiKey, "/search", { query, limit: MAX_RESULTS, location: "Singapore", country: "SG" }, SEARCH_TIMEOUT_MS);
}

export async function fetchFirecrawlScrape(apiKey: string, url: string): Promise<string> {
  const data = await post<{ data?: { markdown?: string } }>(
    apiKey,
    "/scrape",
    { url, formats: ["markdown"], onlyMainContent: true, location: { country: "SG" } },
    SCRAPE_TIMEOUT_MS,
  );
  return data.data?.markdown ?? "";
}

/** Compact, numbered results the model can cite by URL. */
export function formatFirecrawlSearch(data: FirecrawlSearchResponse): { text: string; urls: string[] } {
  const results = (data.data?.web ?? []).filter((r) => r.url).slice(0, MAX_RESULTS);
  if (results.length === 0) return { text: "No results.", urls: [] };
  const lines = results.map((r, i) => `${i + 1}. ${clean(r.title ?? r.url)}\n   ${r.url}\n   ${clean(r.description ?? "")}`);
  return { text: lines.join("\n"), urls: results.map((r) => r.url) };
}

function clean(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}
