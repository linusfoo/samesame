import { describe, expect, it } from "vitest";
import { formatFirecrawlSearch } from "../src/worker/tools/firecrawl";
import { buildTools, type QuotaGate, type ToolIO } from "../src/worker/tools/index";
import type { Tool } from "../src/core/quota";

const LONG_PAGE = "Sony WH-1000XM6 S$529 ".repeat(20);

function gate(limits: Partial<Record<Tool, number>> = {}): QuotaGate & { used: Record<Tool, number> } {
  const used = { firecrawl: 0, jina: 0, browser: 0 };
  return {
    used,
    tryUse(tool) {
      if (used[tool] >= (limits[tool] ?? 99)) return false;
      used[tool]++;
      return true;
    },
  };
}

const searchHit = {
  data: { web: [{ title: "<b>Sony</b> XM6", url: "https://www.lazada.sg/p/xm6", description: "S$529  <strong>deal</strong>" }] },
};

const blocked = async () => {
  throw new Error("blocked");
};

function io(overrides: Partial<ToolIO> = {}): ToolIO {
  return {
    search: async () => searchHit,
    readPage: async () => LONG_PAGE,
    scrapePage: async () => LONG_PAGE,
    browserMarkdown: async () => LONG_PAGE,
    ...overrides,
  };
}

const byName = (tools: ReturnType<typeof buildTools>, name: string) => tools.find((t) => t.name === name)!;

async function readAfterSearch(tools: ReturnType<typeof buildTools>) {
  await byName(tools, "web_search").run({ query: "xm6" });
  return byName(tools, "read_page").run({ url: "https://www.lazada.sg/p/xm6" });
}

describe("formatFirecrawlSearch", () => {
  it("strips markup and lists URLs", () => {
    const { text, urls } = formatFirecrawlSearch({
      data: { web: [...searchHit.data.web, { url: "https://shopee.sg/xm6", description: "S$579 free shipping" }] },
    });
    expect(text).toContain("1. Sony XM6\n   https://www.lazada.sg/p/xm6\n   S$529 deal");
    expect(text).toContain("2. https://shopee.sg/xm6\n   https://shopee.sg/xm6\n   S$579 free shipping");
    expect(urls).toEqual(["https://www.lazada.sg/p/xm6", "https://shopee.sg/xm6"]);
  });
  it("handles empty results", () => {
    expect(formatFirecrawlSearch({})).toEqual({ text: "No results.", urls: [] });
  });
});

describe("web_search", () => {
  it("uses Firecrawl and wraps output as untrusted", async () => {
    const q = gate();
    const out = await byName(buildTools(io(), q), "web_search").run({ query: "xm6" });
    expect(out).toContain("<untrusted_web_content");
    expect(out).toContain("lazada.sg");
    expect(q.used.firecrawl).toBe(1);
  });
  it("refuses when the search budget is spent", async () => {
    const tool = byName(buildTools(io(), gate({ firecrawl: 0 })), "web_search");
    await expect(tool.run({ query: "xm6" })).rejects.toThrow("no search budget");
  });
  it("says so when search isn't set up", async () => {
    const tool = byName(buildTools(io({ search: null }), gate()), "web_search");
    await expect(tool.run({ query: "xm6" })).rejects.toThrow("FIRECRAWL_API_KEY");
  });
});

describe("read_page", () => {
  it("only opens hosts seen in search results", async () => {
    const tools = buildTools(io(), gate());
    const read = byName(tools, "read_page");
    await expect(read.run({ url: "https://www.lazada.sg/p/xm6" })).rejects.toThrow("did not appear");
    await expect(readAfterSearch(tools)).resolves.toContain("S$529");
  });
  it("rejects non-http URLs", async () => {
    const read = byName(buildTools(io(), gate()), "read_page");
    await expect(read.run({ url: "file:///etc/passwd" })).rejects.toThrow("http(s)");
  });
  it("reads with Jina Reader first", async () => {
    const q = gate();
    const out = await readAfterSearch(buildTools(io(), q));
    expect(out).not.toMatch(/\((firecrawl|browser)\)/);
    expect(q.used).toEqual({ firecrawl: 1, jina: 1, browser: 0 });
  });
  it("falls back to a Firecrawl scrape when Jina Reader is blocked", async () => {
    const q = gate();
    const out = await readAfterSearch(buildTools(io({ readPage: blocked }), q));
    expect(out).toContain("(firecrawl)");
    expect(q.used).toEqual({ firecrawl: 2, jina: 1, browser: 0 });
  });
  it("falls back to the browser when both readers fail", async () => {
    const q = gate();
    const out = await readAfterSearch(buildTools(io({ readPage: blocked, scrapePage: async () => "short" }), q));
    expect(out).toContain("(browser)");
    expect(q.used.browser).toBe(1);
  });
  it("reports every reader's failure when none works", async () => {
    const tools = buildTools(io({ readPage: async () => "too short", scrapePage: blocked, browserMarkdown: null }), gate());
    await expect(readAfterSearch(tools)).rejects.toThrow("reader: page too short; firecrawl: Error: blocked");
  });
});
