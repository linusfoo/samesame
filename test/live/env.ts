/**
 * Real APIs for the live tests, with keys from .dev.vars. Uses real quota.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildTools, type ToolIO } from "../../src/worker/tools/index";
import { fetchMarkdown } from "../../src/worker/tools/browser";
import { fetchJina } from "../../src/worker/tools/jina";
import { fetchFirecrawlScrape, fetchFirecrawlSearch } from "../../src/worker/tools/firecrawl";
import type { AgentTool } from "../../src/worker/tools/registry";

export function readDevVars(): Record<string, string> {
  try {
    const text = readFileSync(join(__dirname, "..", "..", ".dev.vars"), "utf8");
    return Object.fromEntries(
      text
        .split(/\r?\n/)
        .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
        .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
    );
  } catch {
    return {};
  }
}

/** A fresh tool set over the real APIs (no daily quota gate). */
export function liveTools(env: Record<string, string>): AgentTool[] {
  const io: ToolIO = {
    search: env.FIRECRAWL_API_KEY ? (q) => fetchFirecrawlSearch(env.FIRECRAWL_API_KEY, q) : null,
    scrapePage: env.FIRECRAWL_API_KEY ? (u) => fetchFirecrawlScrape(env.FIRECRAWL_API_KEY, u) : null,
    readPage: (u) => fetchJina(u, env.JINA_API_KEY || undefined),
    browserMarkdown:
      env.CF_ACCOUNT_ID && env.CF_BROWSER_TOKEN ? (u) => fetchMarkdown(env.CF_ACCOUNT_ID, env.CF_BROWSER_TOKEN, u) : null,
  };
  return buildTools(io, { tryUse: () => true });
}
