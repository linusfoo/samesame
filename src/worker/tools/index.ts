/**
 * Build the tool set an agent sees: web_search and read_page.
 *
 * Every call goes through the daily quota gate. web_search uses Firecrawl.
 * read_page tries Jina Reader, then Firecrawl scrape, then Browser Rendering,
 * and only opens http(s) URLs on hosts that came back from a search in this run.
 */

import type { Tool } from "../../core/quota";
import { formatFirecrawlSearch, type FirecrawlSearchResponse } from "./firecrawl";
import { asUntrusted, type AgentTool } from "./registry";

export type QuotaGate = { tryUse(tool: Tool): boolean };

/** IO the tools need; null means that source is not configured. */
export type ToolIO = {
  search: ((query: string) => Promise<FirecrawlSearchResponse>) | null;
  readPage: ((url: string) => Promise<string>) | null;
  scrapePage: ((url: string) => Promise<string>) | null;
  browserMarkdown: ((url: string) => Promise<string>) | null;
};

/** Below this, an extraction is treated as failed (blocked or empty page). */
const MIN_PAGE_CHARS = 200;

type Reader = { name: string; tool: Tool; read: ((url: string) => Promise<string>) | null; label: (url: string) => string };

export function buildTools(io: ToolIO, quota: QuotaGate): AgentTool[] {
  const seenHosts = new Set<string>();
  const remember = (urls: string[]) => {
    for (const u of urls) {
      const host = hostOf(u);
      if (host) seenHosts.add(host);
    }
  };

  const readers: Reader[] = [
    { name: "reader", tool: "jina", read: io.readPage, label: (u) => u },
    { name: "firecrawl", tool: "firecrawl", read: io.scrapePage, label: (u) => `${u} (firecrawl)` },
    { name: "browser", tool: "browser", read: io.browserMarkdown, label: (u) => `${u} (browser)` },
  ];

  const tools: AgentTool[] = [];

  tools.push({
    name: "web_search",
    description:
      "Search the web from Singapore. Returns titles, URLs and snippets (sometimes prices). Use for finding where a product is sold in Singapore, and for reviews.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Search query" } },
      required: ["query"],
    },
    async run(args) {
      const query = String(args.query ?? "").trim();
      if (!query) throw new Error("query is required");
      if (!io.search) throw new Error("search is not set up (FIRECRAWL_API_KEY)");
      if (!quota.tryUse("firecrawl")) throw new Error("no search budget left today");
      const { text, urls } = formatFirecrawlSearch(await io.search(query));
      remember(urls);
      return asUntrusted("web search", text);
    },
  });

  tools.push({
    name: "read_page",
    description:
      "Read one product page as text (price, seller, warranty, variant). Only URLs returned by a search in this session are allowed.",
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "Full http(s) URL from a search result" } },
      required: ["url"],
    },
    async run(args) {
      const url = String(args.url ?? "");
      const host = hostOf(url);
      if (!host) throw new Error("only http(s) URLs can be read");
      if (!seenHosts.has(host)) throw new Error(`${host} did not appear in any search result`);

      const errors: string[] = [];
      for (const r of readers) {
        if (!r.read || !quota.tryUse(r.tool)) continue;
        try {
          const text = await r.read(url);
          if (text.length >= MIN_PAGE_CHARS) return asUntrusted(r.label(url), text);
          errors.push(`${r.name}: page too short`);
        } catch (err) {
          errors.push(`${r.name}: ${String(err)}`);
        }
      }
      throw new Error(errors.length ? errors.join("; ") : "no page-reading budget left today");
    },
  });

  return tools;
}

export function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
