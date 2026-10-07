import { describe, expect, it } from "vitest";
import {
  appendTurns,
  describeForChat,
  extractUrls,
  hasChatData,
  keepCitedSources,
  knownSources,
  MAX_TURNS_KEPT,
  parseQuestion,
  recentHistory,
  type ChatContext,
  type ChatTurn,
} from "../src/core/chat";
import { groupListings, matchListing, type Target } from "../src/core/match";

const target: Target = { modelNumber: "S2722QC", variant: {}, pinned: { storage: false, size: false } };
const listings = [
  matchListing(target, {
    source: "shopee.sg",
    url: "https://shopee.sg/dell-s2722qc",
    title: "Dell S2722QC 27\" 4K USB-C Monitor",
    priceText: "S$429.00",
    warranty: "local",
    vouchers: ["S$10 off"],
  }),
  matchListing(target, {
    source: "lazada.sg",
    url: "https://lazada.sg/dell-s2722qc",
    title: "DELL S2722QC Refurbished",
    priceText: "S$399.00",
  }),
];

const context: ChatContext = {
  input: { mode: "model", query: "Dell S2722QC", description: "", priorities: "local warranty" },
  candidates: null,
  products: [{ name: "Dell S2722QC", modelNumber: "S2722QC", groups: groupListings(listings) }],
};

describe("parseQuestion", () => {
  it("trims and accepts a question", () => {
    expect(parseQuestion("  Which has local warranty? ")).toEqual({ ok: true, value: "Which has local warranty?" });
  });
  it("refuses empty, non-text and overlong questions", () => {
    expect(parseQuestion("   ").ok).toBe(false);
    expect(parseQuestion(42).ok).toBe(false);
    expect(parseQuestion("x".repeat(501)).ok).toBe(false);
  });
});

describe("describeForChat", () => {
  const text = describeForChat(context);
  it("wraps the data so the model treats it as data", () => {
    expect(text.startsWith("<gathered_data>")).toBe(true);
    expect(text.endsWith("</gathered_data>")).toBe(true);
  });
  it("gives each listing its price, warranty, whether it counts and its link", () => {
    const shopee = text.split("\n").find((l) => l.includes("shopee.sg"))!;
    expect(shopee).toContain("S$429.00");
    expect(shopee).toContain("local warranty");
    expect(shopee).toContain("counts toward the comparison");
    expect(shopee).toContain("vouchers: S$10 off");
    expect(shopee).toContain("https://shopee.sg/dell-s2722qc");
    const lazada = text.split("\n").find((l) => l.includes("lazada.sg"))!;
    expect(lazada).toContain("refurbished");
    expect(lazada).toContain("does not count");
  });
  it("includes the search and the shopper's priorities", () => {
    expect(text).toContain("Dell S2722QC");
    expect(text).toContain("What matters to them: local warranty");
  });
  it("lists candidates in category mode", () => {
    const withCandidates = describeForChat({
      input: null,
      candidates: [{ brand: "LG", name: "UltraFine 27UP850N", modelNumber: "27UP850N", reason: "USB-C 96W" }],
      products: [],
    });
    expect(withCandidates).toContain("LG UltraFine 27UP850N (27UP850N): USB-C 96W");
  });
});

describe("hasChatData", () => {
  it("needs listings or candidates", () => {
    expect(hasChatData(context)).toBe(true);
    expect(hasChatData({ input: null, candidates: null, products: [{ name: "x", modelNumber: null, groups: null }] })).toBe(false);
  });
});

describe("keepCitedSources", () => {
  const known = knownSources(context);
  it("keeps listing links with their shop name and drops made-up links", () => {
    expect(
      keepCitedSources(["https://shopee.sg/dell-s2722qc", "https://example.com/invented", "https://shopee.sg/dell-s2722qc"], known, []),
    ).toEqual([{ url: "https://shopee.sg/dell-s2722qc", label: "shopee.sg" }]);
  });
  it("keeps links the lookups actually returned, labelled by host", () => {
    expect(keepCitedSources(["https://www.rtings.com/monitor/dell"], known, ["https://www.rtings.com/monitor/dell"])).toEqual([
      { url: "https://www.rtings.com/monitor/dell", label: "rtings.com" },
    ]);
  });
});

describe("extractUrls", () => {
  it("finds links in tool output without trailing punctuation", () => {
    expect(extractUrls('1. Review — https://rtings.com/a. See "https://x.sg/b?c=1".')).toEqual([
      "https://rtings.com/a",
      "https://x.sg/b?c=1",
    ]);
  });
});

describe("chat history", () => {
  const q = (text: string): ChatTurn => ({ role: "user", text, at: 0 });
  const a = (text: string, failed = false): ChatTurn => ({ role: "assistant", text, at: 0, failed });

  it("keeps answered exchanges and drops a failed one with its question", () => {
    expect(recentHistory([q("1"), a("one"), q("2"), a("oops", true), q("3"), a("three")]).map((t) => t.text)).toEqual([
      "1",
      "one",
      "3",
      "three",
    ]);
  });
  it("leaves out the question still waiting for an answer", () => {
    expect(recentHistory([q("1"), a("one"), q("2")]).map((t) => t.text)).toEqual(["1", "one"]);
  });
  it("keeps only the most recent turns", () => {
    const turns = Array.from({ length: 10 }, (_, i) => [q(`${i}`), a(`${i}`)]).flat();
    expect(recentHistory(turns, 4).map((t) => t.text)).toEqual(["8", "8", "9", "9"]);
  });
  it("caps the stored conversation", () => {
    const many = Array.from({ length: MAX_TURNS_KEPT }, (_, i) => q(`${i}`));
    const next = appendTurns(many, q("new"));
    expect(next).toHaveLength(MAX_TURNS_KEPT);
    expect(next.at(-1)!.text).toBe("new");
  });
});
