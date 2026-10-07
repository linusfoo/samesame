/**
 * Brave Search REST API, Singapore-localised.
 * fetchBrave does IO; formatBrave is pure and tested.
 */

const BRAVE_URL = "https://api.search.brave.com/res/v1/web/search";
const BRAVE_TIMEOUT_MS = 15_000;
const MAX_RESULTS = 8;

export type BraveResult = {
  title: string;
  url: string;
  description?: string;
  extra_snippets?: string[];
  product?: { price?: string; name?: string };
};

export type BraveResponse = { web?: { results?: BraveResult[] } };

export async function fetchBrave(apiKey: string, query: string): Promise<BraveResponse> {
  const url = new URL(BRAVE_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("country", "SG");
  url.searchParams.set("count", String(MAX_RESULTS));
  url.searchParams.set("extra_snippets", "true");
  const res = await fetch(url, {
    headers: { accept: "application/json", "x-subscription-token": apiKey },
    signal: AbortSignal.timeout(BRAVE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Brave returned ${res.status}`);
  return res.json();
}

/** Compact, numbered results the model can cite by URL. */
export function formatBrave(data: BraveResponse): { text: string; urls: string[] } {
  const results = (data.web?.results ?? []).slice(0, MAX_RESULTS);
  if (results.length === 0) return { text: "No results.", urls: [] };
  const lines = results.map((r, i) => {
    const snippets = [r.description, ...(r.extra_snippets ?? []).slice(0, 2)]
      .filter(Boolean)
      .map((s) => stripTags(s!))
      .join(" … ");
    const price = r.product?.price ? ` | price: ${r.product.price}` : "";
    return `${i + 1}. ${stripTags(r.title)}${price}\n   ${r.url}\n   ${snippets}`;
  });
  return { text: lines.join("\n"), urls: results.map((r) => r.url) };
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}
