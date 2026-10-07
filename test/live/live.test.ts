/**
 * The three simulated searches, run for real: OpenCode Go, Brave, Tavily over
 * MCP and Browser Rendering, with keys from .dev.vars. Uses real quota.
 *
 *   npm run test:live
 *
 * Prints a summary per product and checks the story 1 bar: at least three
 * shops matched, at most six tool calls, under five minutes.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { openCodeModel } from "../../src/worker/llm";
import { runResearch, type ResearchInput } from "../../src/worker/research";
import { buildTools, type ToolIO } from "../../src/worker/tools/index";
import { fetchBrave } from "../../src/worker/tools/brave";
import { fetchMarkdown } from "../../src/worker/tools/browser";
import { tavilyExtract, tavilyMcpUrl, tavilySearch, type McpCaller, type McpToolResult } from "../../src/worker/tools/tavily-mcp";
import { formatSgd } from "../../src/core/price";

const PRODUCTS: ResearchInput[] = [
  { mode: "model", query: "Sony WH-1000XM6 headphones", description: "Black, over-ear", priorities: "Local warranty, cheapest new unit" },
  { mode: "model", query: "Dyson V15 Detect Absolute", description: "Cordless stick vacuum", priorities: "Official warranty" },
  { mode: "model", query: "Samsung Galaxy S25 Ultra 256GB Titanium Black", description: "Phone", priorities: "Local set only" },
];

const FIVE_MINUTES = 5 * 60_000;

function readDevVars(): Record<string, string> {
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

async function connectTavily(key: string): Promise<McpCaller | null> {
  const client = new Client({ name: "buying-helper-live-test", version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(tavilyMcpUrl(key))));
  const names = (await client.listTools()).tools.map((t) => t.name);
  return {
    toolNames: () => names,
    call: async (name, args) => (await client.callTool({ name, arguments: args })) as McpToolResult,
  };
}

const env = readDevVars();

describe.skipIf(!env.OPENCODE_API_KEY)("live searches", () => {
  for (const input of PRODUCTS) {
    it(
      input.query,
      async () => {
        const mcp = env.TAVILY_API_KEY ? await connectTavily(env.TAVILY_API_KEY) : null;
        const io: ToolIO = {
          brave: env.BRAVE_API_KEY ? (q) => fetchBrave(env.BRAVE_API_KEY, q) : null,
          tavilySearch: mcp ? (q) => tavilySearch(mcp, q) : null,
          tavilyExtract: mcp ? (u) => tavilyExtract(mcp, u) : null,
          browserMarkdown:
            env.CF_ACCOUNT_ID && env.CF_BROWSER_TOKEN
              ? (u) => fetchMarkdown(env.CF_ACCOUNT_ID, env.CF_BROWSER_TOKEN, u)
              : null,
        };
        const started = Date.now();
        const outcome = await runResearch(input, {
          model: openCodeModel(env.OPENCODE_API_KEY),
          tools: buildTools(io, { tryUse: () => true }),
        });
        const elapsed = Date.now() - started;
        const toolCalls = outcome.trace.filter((e) => e.kind === "tool" && !e.detail.startsWith("refused")).length;

        console.log(
          [
            `\n=== ${input.query} (${Math.round(elapsed / 1000)}s, ${toolCalls} tool calls) ===`,
            outcome.error ? `ERROR: ${outcome.error}` : `Product: ${outcome.product?.brand} ${outcome.product?.name} [${outcome.product?.modelNumber ?? "no model number"}]`,
            ...outcome.listings.map(
              (l) =>
                `  ${l.status.padEnd(11)} ${(l.price === null ? "—" : l.currency === "SGD" ? formatSgd(l.price) : `${l.currency} ${l.price}`).padEnd(12)} ${l.source.padEnd(20)} ${l.title.slice(0, 70)}`,
            ),
            ...outcome.trace.filter((e) => !e.ok).map((e) => `  ! ${e.agent} ${e.name}: ${e.detail}`),
          ].join("\n"),
        );

        expect(outcome.error).toBeNull();
        expect(toolCalls).toBeLessThanOrEqual(6);
        expect(elapsed).toBeLessThan(FIVE_MINUTES);
        expect(outcome.matchedSources).toBeGreaterThanOrEqual(3);
      },
      FIVE_MINUTES + 30_000,
    );
  }
});
