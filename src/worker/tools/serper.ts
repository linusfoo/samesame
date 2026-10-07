/**
 * Serper (Google results) REST API, localised to Singapore.
 * Free plan: 2,500 searches once, no card. fetchSerper does IO; formatSerper
 * is pure and tested.
 */

const SERPER_URL = "https://google.serper.dev/search";
const SERPER_TIMEOUT_MS = 15_000;
const MAX_RESULTS = 8;

export type SerperResult = {
  title: string;
  link: string;
  snippet?: string;
  price?: string | number;
  priceRange?: string;
  rating?: number;
  ratingCount?: number;
};

export type SerperResponse = { organic?: SerperResult[] };

export async function fetchSerper(apiKey: string, query: string): Promise<SerperResponse> {
  const res = await fetch(SERPER_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({ q: query, gl: "sg", hl: "en", num: MAX_RESULTS }),
    signal: AbortSignal.timeout(SERPER_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Serper returned ${res.status}`);
  return res.json();
}

/** Compact, numbered results the model can cite by URL. */
export function formatSerper(data: SerperResponse): { text: string; urls: string[] } {
  const results = (data.organic ?? []).filter((r) => r.link).slice(0, MAX_RESULTS);
  if (results.length === 0) return { text: "No results.", urls: [] };
  const lines = results.map((r, i) => {
    const price = r.price !== undefined ? ` | price: ${r.price}` : r.priceRange ? ` | price: ${r.priceRange}` : "";
    const rating = r.rating !== undefined ? ` | rating ${r.rating}${r.ratingCount ? ` (${r.ratingCount})` : ""}` : "";
    return `${i + 1}. ${clean(r.title)}${price}${rating}\n   ${r.link}\n   ${clean(r.snippet ?? "")}`;
  });
  return { text: lines.join("\n"), urls: results.map((r) => r.link) };
}

function clean(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}
