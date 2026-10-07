/**
 * Real APIs for the live tests, with keys from .dev.vars. Uses real quota.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { buildTools, type ToolIO } from "../../src/worker/tools/index";
import { fetchBrave } from "../../src/worker/tools/brave";
import { fetchMarkdown } from "../../src/worker/tools/browser";
import { tavilyExtract, tavilyMcpUrl, tavilySearch, type McpCaller, type McpToolResult } from "../../src/worker/tools/tavily-mcp";
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

async function connectTavily(key: string): Promise<McpCaller | null> {
  const client = new Client({ name: "buying-helper-live-test", version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(tavilyMcpUrl(key))));
  const names = (await client.listTools()).tools.map((t) => t.name);
  return {
    toolNames: () => names,
    call: async (name, args) => (await client.callTool({ name, arguments: args })) as McpToolResult,
  };
}

/** A fresh tool set over the real APIs (no daily quota gate). */
export async function liveTools(env: Record<string, string>): Promise<AgentTool[]> {
  const mcp = env.TAVILY_API_KEY ? await connectTavily(env.TAVILY_API_KEY) : null;
  const io: ToolIO = {
    brave: env.BRAVE_API_KEY ? (q) => fetchBrave(env.BRAVE_API_KEY, q) : null,
    tavilySearch: mcp ? (q) => tavilySearch(mcp, q) : null,
    tavilyExtract: mcp ? (u) => tavilyExtract(mcp, u) : null,
    browserMarkdown:
      env.CF_ACCOUNT_ID && env.CF_BROWSER_TOKEN ? (u) => fetchMarkdown(env.CF_ACCOUNT_ID, env.CF_BROWSER_TOKEN, u) : null,
  };
  return buildTools(io, { tryUse: () => true });
}
