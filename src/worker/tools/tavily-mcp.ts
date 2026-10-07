/**
 * Tavily through its remote MCP server (https://mcp.tavily.com/mcp/).
 *
 * The connection itself is owned by the Durable Object (Agents SDK
 * addMcpServer); this module only needs something that can call a tool.
 */

export const TAVILY_MCP_URL = "https://mcp.tavily.com/mcp/";

export function tavilyMcpUrl(apiKey: string): string {
  return `${TAVILY_MCP_URL}?tavilyApiKey=${encodeURIComponent(apiKey)}`;
}

export type McpCaller = {
  /** Tool names the server advertised. */
  toolNames(): string[];
  call(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
};

export type McpToolResult = {
  content?: { type: string; text?: string }[];
  isError?: boolean;
};

/** Tavily has renamed tools before (tavily-search / tavily_search); match loosely. */
export function findTool(names: string[], kind: "search" | "extract"): string | null {
  return names.find((n) => n.toLowerCase().includes("tavily") && n.toLowerCase().includes(kind)) ??
    names.find((n) => n.toLowerCase().includes(kind)) ??
    null;
}

export function mcpText(result: McpToolResult): string {
  const text = (result.content ?? [])
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text)
    .join("\n")
    .trim();
  if (result.isError) throw new Error(text || "MCP tool error");
  return text;
}

export async function tavilySearch(mcp: McpCaller, query: string): Promise<string> {
  const name = findTool(mcp.toolNames(), "search");
  if (!name) throw new Error("Tavily MCP has no search tool");
  return mcpText(
    await mcp.call(name, { query, max_results: 6, search_depth: "basic", country: "singapore" }),
  );
}

export async function tavilyExtract(mcp: McpCaller, url: string): Promise<string> {
  const name = findTool(mcp.toolNames(), "extract");
  if (!name) throw new Error("Tavily MCP has no extract tool");
  return mcpText(await mcp.call(name, { urls: [url], extract_depth: "basic" }));
}

/** URLs mentioned in Tavily's text output, so read_page can open them. */
export function urlsIn(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s)\]"'<>]+/g)].map((m) => m[0]);
}
