import { describe, expect, it } from "vitest";
import { formatSerper } from "../src/worker/tools/serper";
import { buildTools, type QuotaGate, type ToolIO } from "../src/worker/tools/index";
import type { Tool } from "../src/core/quota";

const LONG_PAGE = "Sony WH-1000XM6 S$529 ".repeat(20);

function gate(limits: Partial<Record<Tool, number>> = {}): QuotaGate & { used: Record<Tool, number> } {
  const used = { serper: 0, jina: 0, browser: 0 };
  return {
    used,
    tryUse(tool) {
      if (used[tool] >= (limits[tool] ?? 99)) return false;
      used[tool]++;
      return true;
    },
  };
}

const serperHit = {
  organic: [{ title: "<b>Sony</b> XM6", link: "https://www.lazada.sg/p/xm6", snippet: "S$529  <strong>deal</strong>" }],
};

function io(overrides: Partial<ToolIO> = {}): ToolIO {
  return {
    search: async () => serperHit,
    readPage: async () => LONG_PAGE,
    browserMarkdown: async () => LONG_PAGE,
    ...overrides,
  };
}

const byName = (tools: ReturnType<typeof buildTools>, name: string) => tools.find((t) => t.name === name)!;

describe("formatSerper", () => {
  it("strips markup, keeps price and rating, and lists URLs", () => {
    const { text, urls } = formatSerper({
      organic: [
        ...serperHit.organic,
        { title: "Sony XM6 | Shopee", link: "https://shopee.sg/xm6", snippet: "Free shipping", price: "S$579.00", rating: 4.9, ratingCount: 1200 },
      ],
    });
    expect(text).toContain("1. Sony XM6\n   https://www.lazada.sg/p/xm6\n   S$529 deal");
    expect(text).toContain("2. Sony XM6 | Shopee | price: S$579.00 | rating 4.9 (1200)");
    expect(urls).toEqual(["https://www.lazada.sg/p/xm6", "https://shopee.sg/xm6"]);
  });
  it("handles empty results", () => {
    expect(formatSerper({})).toEqual({ text: "No results.", urls: [] });
  });
});

describe("web_search", () => {
  it("uses Serper and wraps output as untrusted", async () => {
    const q = gate();
    const out = await byName(buildTools(io(), q), "web_search").run({ query: "xm6" });
    expect(out).toContain("<untrusted_web_content");
    expect(out).toContain("lazada.sg");
    expect(q.used.serper).toBe(1);
  });
  it("refuses when the search budget is spent", async () => {
    const tool = byName(buildTools(io(), gate({ serper: 0 })), "web_search");
    await expect(tool.run({ query: "xm6" })).rejects.toThrow("no search budget");
  });
  it("says so when search isn't set up", async () => {
    const tool = byName(buildTools(io({ search: null }), gate()), "web_search");
    await expect(tool.run({ query: "xm6" })).rejects.toThrow("SERPER_API_KEY");
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
  it("reads with Jina Reader first", async () => {
    const q = gate();
    const tools = buildTools(io(), q);
    await byName(tools, "web_search").run({ query: "xm6" });
    const out = await byName(tools, "read_page").run({ url: "https://www.lazada.sg/p/xm6" });
    expect(out).not.toContain("(browser)");
    expect(q.used).toMatchObject({ jina: 1, browser: 0 });
  });
  it("falls back to the browser when Jina Reader is blocked", async () => {
    const q = gate();
    const tools = buildTools(io({ readPage: async () => { throw new Error("Jina Reader returned 451"); } }), q);
    await byName(tools, "web_search").run({ query: "xm6" });
    const out = await byName(tools, "read_page").run({ url: "https://www.lazada.sg/p/xm6" });
    expect(out).toContain("(browser)");
    expect(q.used.browser).toBe(1);
  });
  it("reports why when the reader fails and there is no browser", async () => {
    const tools = buildTools(io({ readPage: async () => "too short", browserMarkdown: null }), gate());
    await byName(tools, "web_search").run({ query: "xm6" });
    await expect(byName(tools, "read_page").run({ url: "https://www.lazada.sg/p/xm6" })).rejects.toThrow("reader: page too short");
  });
});
