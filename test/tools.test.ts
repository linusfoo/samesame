import { describe, expect, it } from "vitest";
import { formatBrave } from "../src/worker/tools/brave";
import { buildTools, type QuotaGate, type ToolIO } from "../src/worker/tools/index";
import { findTool, mcpText } from "../src/worker/tools/tavily-mcp";
import type { Tool } from "../src/core/quota";

const LONG_PAGE = "Sony WH-1000XM6 S$529 ".repeat(20);

function gate(limits: Partial<Record<Tool, number>> = {}): QuotaGate & { used: Record<Tool, number> } {
  const used = { brave: 0, tavily: 0, browser: 0 };
  return {
    used,
    tryUse(tool) {
      if (used[tool] >= (limits[tool] ?? 99)) return false;
      used[tool]++;
      return true;
    },
  };
}

const braveHit = {
  web: { results: [{ title: "<b>Sony</b> XM6", url: "https://www.lazada.sg/p/xm6", description: "S$529 <strong>deal</strong>" }] },
};

function io(overrides: Partial<ToolIO> = {}): ToolIO {
  return {
    brave: async () => braveHit,
    tavilySearch: async () => "Result: https://shopee.sg/xm6 S$579",
    tavilyExtract: async () => LONG_PAGE,
    browserMarkdown: async () => LONG_PAGE,
    ...overrides,
  };
}

const byName = (tools: ReturnType<typeof buildTools>, name: string) => tools.find((t) => t.name === name)!;

describe("formatBrave", () => {
  it("strips markup and lists URLs", () => {
    const { text, urls } = formatBrave(braveHit);
    expect(text).toContain("1. Sony XM6");
    expect(text).toContain("S$529 deal");
    expect(urls).toEqual(["https://www.lazada.sg/p/xm6"]);
  });
  it("handles empty results", () => {
    expect(formatBrave({}).text).toBe("No results.");
  });
});

describe("tavily MCP helpers", () => {
  it("finds tools whatever the naming style", () => {
    expect(findTool(["tavily-search", "tavily-extract"], "extract")).toBe("tavily-extract");
    expect(findTool(["tavily_search"], "search")).toBe("tavily_search");
    expect(findTool(["other"], "search")).toBeNull();
  });
  it("throws on MCP error results", () => {
    expect(() => mcpText({ isError: true, content: [{ type: "text", text: "bad key" }] })).toThrow("bad key");
  });
});

describe("web_search", () => {
  it("uses Brave and wraps output as untrusted", async () => {
    const q = gate();
    const out = await byName(buildTools(io(), q), "web_search").run({ query: "xm6" });
    expect(out).toContain("<untrusted_web_content");
    expect(q.used.brave).toBe(1);
  });
  it("falls back to Tavily when the Brave budget is spent", async () => {
    const q = gate({ brave: 0 });
    const out = await byName(buildTools(io(), q), "web_search").run({ query: "xm6" });
    expect(out).toContain("shopee.sg");
    expect(q.used.tavily).toBe(1);
  });
  it("refuses when every budget is spent", async () => {
    const tool = byName(buildTools(io(), gate({ brave: 0, tavily: 0 })), "web_search");
    await expect(tool.run({ query: "xm6" })).rejects.toThrow("no search budget");
  });
});

describe("read_page", () => {
  it("only opens hosts seen in search results", async () => {
    const tools = buildTools(io(), gate());
    const read = byName(tools, "read_page");
    await expect(read.run({ url: "https://www.lazada.sg/p/xm6" })).rejects.toThrow("did not appear");
    await byName(tools, "web_search").run({ query: "xm6" });
    await expect(read.run({ url: "https://www.lazada.sg/p/xm6" })).resolves.toContain("S$529");
  });
  it("rejects non-http URLs", async () => {
    const read = byName(buildTools(io(), gate()), "read_page");
    await expect(read.run({ url: "file:///etc/passwd" })).rejects.toThrow("http(s)");
  });
  it("falls back to the browser when Tavily extract fails", async () => {
    const q = gate();
    const tools = buildTools(io({ tavilyExtract: async () => { throw new Error("blocked"); } }), q);
    await byName(tools, "web_search").run({ query: "xm6" });
    const out = await byName(tools, "read_page").run({ url: "https://www.lazada.sg/p/xm6" });
    expect(out).toContain("(browser)");
    expect(q.used.browser).toBe(1);
  });
  it("skips the browser when its budget is spent and reports why", async () => {
    const q = gate({ browser: 0 });
    const tools = buildTools(io({ tavilyExtract: async () => "too short" }), q);
    await byName(tools, "web_search").run({ query: "xm6" });
    await expect(byName(tools, "read_page").run({ url: "https://www.lazada.sg/p/xm6" })).rejects.toThrow("page too short");
  });
});
