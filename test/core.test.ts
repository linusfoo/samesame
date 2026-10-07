import { describe, expect, it } from "vitest";
import { extractModelCodes, parseModelCode, sameFamily } from "../src/core/sku";
import { parsePrice } from "../src/core/price";
import { detectCondition, detectVariant, pinnedFromRequest } from "../src/core/listing";
import { applyLlmDecision, groupListings, matchListing, variantCounts } from "../src/core/match";
import { canUse, consume, currentQuota, emptyQuota, remaining, sgDay, type QuotaState } from "../src/core/quota";
import { checkPicks, parseResearchInput } from "../src/core/request";

describe("parseModelCode", () => {
  it("splits colour suffixes after a slash", () => {
    expect(parseModelCode("WH-1000XM6/B")).toEqual({ raw: "WH-1000XM6/B", family: "WH1000XM6", suffix: "B" });
  });
  it("splits a short letter suffix after the last dash", () => {
    expect(parseModelCode("27GR95QE-B")).toMatchObject({ family: "27GR95QE", suffix: "B" });
  });
  it("keeps dashes that are part of the model", () => {
    expect(parseModelCode("SM-S938B")).toMatchObject({ family: "SMS938B", suffix: null });
    expect(parseModelCode("ILCE-7M4")).toMatchObject({ family: "ILCE7M4", suffix: null });
  });
  it("ignores units and short tokens", () => {
    for (const t of ["256GB", "4.1L", "240Hz", "28-70mm", "5G", "A7", "S25", "1080p"]) {
      expect(parseModelCode(t)).toBeNull();
    }
  });
});

describe("sameFamily", () => {
  it("accepts region and colour codes appended to the model", () => {
    expect(sameFamily("SMS938B", "SMS938BZKCXSP")).toBe(true);
  });
  it("rejects tier words and neighbouring models", () => {
    expect(sameFamily("RTX4070", "RTX4070TI")).toBe(false);
    expect(sameFamily("WH1000XM5", "WH1000XM6")).toBe(false);
  });
});

describe("extractModelCodes", () => {
  it("finds the model inside a busy title", () => {
    const codes = extractModelCodes("Sony WH-1000XM6 Black (WH-1000XM6/B) | 1 Year Warranty");
    expect(codes.map((c) => c.family)).toEqual(["WH1000XM6"]);
  });
});

describe("parsePrice", () => {
  it("parses SGD formats", () => {
    expect(parsePrice("S$1,299.00").amount).toBe(1299);
    expect(parsePrice("$1299").amount).toBe(1299);
    expect(parsePrice("SGD 149.00").amount).toBe(149);
  });
  it("takes the sale price from a strike-through pair", () => {
    expect(parsePrice("S$1,599.00 S$1,299.00")).toEqual({ amount: 1299, original: 1599, currency: "SGD" });
  });
  it("skips shipping, savings and instalments", () => {
    expect(parsePrice("S$3,199 + S$8.00 shipping").amount).toBe(3199);
    expect(parsePrice("Save S$200 S$1,648.00").amount).toBe(1648);
    expect(parsePrice("S$1,200 or 3 instalments of S$400").amount).toBe(1200);
  });
  it("keeps foreign currency instead of guessing", () => {
    expect(parsePrice("US$1,099.99")).toEqual({ amount: 1099.99, original: null, currency: "USD" });
  });
  it("returns nulls when there is no price", () => {
    expect(parsePrice("See store")).toEqual({ amount: null, original: null, currency: null });
  });
});

describe("detectVariant", () => {
  it("prefers the longer colour name and the larger storage figure", () => {
    expect(detectVariant("Galaxy S25 Ultra 12GB+256GB Titanium Black")).toEqual({
      color: "titanium black",
      storage: "256GB",
    });
  });
});

describe("detectCondition", () => {
  it("reads 'like new' as a used unit", () => {
    expect(detectCondition("Sony XM6 headphones like new, box included")).toBe("used");
    expect(detectCondition("Sony WH-1000XM6 brand new sealed")).toBe("new");
  });
});

describe("size and pinning", () => {
  it("reads screen size in inches but not stock counts", () => {
    expect(detectVariant('LG 27" OLED').size).toBe("27in");
    expect(detectVariant("Samsung 65-inch TV").size).toBe("65in");
    expect(detectVariant("Monitor 32 inch 4K").size).toBe("32in");
    expect(detectVariant("Dell 27in monitor").size).toBe("27in");
    expect(detectVariant("Only 27 in stock").size).toBeUndefined();
  });
  it("pins storage or size named in the product or the description", () => {
    expect(pinnedFromRequest("Galaxy S25 Ultra 512GB", "")).toEqual({ storage: true, size: false });
    expect(pinnedFromRequest("Galaxy S25 Ultra", "want the 256GB one")).toEqual({ storage: true, size: false });
    expect(pinnedFromRequest("4K monitor", "27-inch, IPS")).toEqual({ storage: false, size: true });
    expect(pinnedFromRequest("Sony WH-1000XM6", "black")).toEqual({ storage: false, size: false });
  });
});

describe("comparable variants", () => {
  const phone = (pinned: { storage: boolean; size: boolean }) => ({
    modelNumber: "SM-S938B",
    variant: { color: "titanium black", storage: "256GB" },
    pinned,
  });
  const mk = (target: Parameters<typeof matchListing>[0], title: string) =>
    matchListing(target, { source: "s", url: "https://s.sg", title, priceText: "S$1,500" });

  it("counts a colour-only variant", () => {
    const got = mk(phone({ storage: true, size: false }), "Galaxy S25 Ultra 256GB Titanium Gray SM-S938B");
    expect(got.status).toBe("variant");
    expect(got.differs).toEqual(["color"]);
    expect(got.comparable).toBe(true);
  });
  it("does not count another storage size when the shopper named one", () => {
    const got = mk(phone({ storage: true, size: false }), "Galaxy S25 Ultra 512GB Titanium Black SM-S938B");
    expect(got.status).toBe("variant");
    expect(got.comparable).toBe(false);
  });
  it("counts another storage size when the shopper left it open", () => {
    const got = mk(phone({ storage: false, size: false }), "Galaxy S25 Ultra 512GB Titanium Black SM-S938B");
    expect(got.comparable).toBe(true);
  });
  it("ignores letter case in colours the agent reports", () => {
    const got = matchListing({ modelNumber: "WH-1000XM6/B", variant: { color: "black" } }, {
      source: "courts.com.sg",
      url: "https://courts.com.sg/x",
      title: "SONY Wireless Noise Cancelling Headphone (black) WH-1000XM6/BME",
      priceText: "S$509.00",
      variant: { color: "Black " },
    });
    expect(got.status).toBe("same");
  });
  it("doesn't trust a listing that sells several models of the range", () => {
    const got = matchListing({ modelNumber: "WH-1000XM6/B", variant: {} }, {
      source: "lazada.sg",
      url: "https://lazada.sg/x",
      title: "SONY WH-1000XM6 / WH-1000XM5 Black /Silver Headphone",
      priceText: "S$393.00",
    });
    expect(got.status).toBe("unconfirmed");
    expect(got.reason).toMatch(/several models/);
    expect(got.comparable).toBe(false);
  });
  it("treats a model suffix difference as colour", () => {
    const got = mk({ modelNumber: "WH-1000XM6/B", variant: {} }, "Sony WH-1000XM6/S headphones");
    expect(got.status).toBe("variant");
    expect(got.differs).toEqual(["color"]);
    expect(got.comparable).toBe(true);
  });
  it("still excludes bundles and refurbished units", () => {
    const target = { modelNumber: "WH-1000XM6/B", variant: {} };
    expect(mk(target, "Sony WH-1000XM6/B + Free Case").comparable).toBe(false);
    expect(mk(target, "Refurbished Sony WH-1000XM6/B").comparable).toBe(false);
  });
  it("variantCounts allows only colour and unpinned fields", () => {
    expect(variantCounts(["color"], { storage: true, size: true })).toBe(true);
    expect(variantCounts(["size"], { storage: false, size: true })).toBe(false);
    expect(variantCounts(["other"], { storage: false, size: false })).toBe(false);
  });
});

describe("shipping and vouchers", () => {
  it("keeps them beside the base price without adding them in", () => {
    const got = matchListing({ modelNumber: "WH-1000XM6/B", variant: {} }, {
      source: "shopee.sg",
      url: "https://shopee.sg/x",
      title: "Sony WH-1000XM6/B",
      priceText: "S$529.00",
      shippingText: " S$3.99 shipping ",
      vouchers: ["S$20 off min spend S$300", " ", "Coins cashback", "4th"],
    });
    expect(got.price).toBe(529);
    expect(got.shippingText).toBe("S$3.99 shipping");
    expect(got.vouchers).toEqual(["S$20 off min spend S$300", "Coins cashback", "4th"]);
  });
  it("defaults to none when the agent reports nothing", () => {
    const got = matchListing({ modelNumber: null, variant: {} }, { source: "a", url: "https://a.sg", title: "x" });
    expect(got.shippingText).toBe("");
    expect(got.vouchers).toEqual([]);
  });
});

describe("LLM fallback", () => {
  const target = { modelNumber: null, variant: {} };
  const listing = matchListing(target, {
    source: "courts.com.sg",
    url: "https://example.sg/x",
    title: "Dyson V15 Detect Absolute",
    priceText: "S$1,049.00",
  });

  it("marks confident same as llm_same and comparable", () => {
    const got = applyLlmDecision(listing, { verdict: "same", confidence: 0.9, reason: "same name" });
    expect(got.status).toBe("llm_same");
    expect(got.comparable).toBe(true);
  });
  it("marks low confidence as unconfirmed", () => {
    const got = applyLlmDecision(listing, { verdict: "same", confidence: 0.4, reason: "maybe" });
    expect(got.status).toBe("unconfirmed");
    expect(got.comparable).toBe(false);
  });
  it("counts an LLM variant only when it says what differs and that is allowed", () => {
    const colour = applyLlmDecision(listing, { verdict: "variant", confidence: 0.9, reason: "blue", differs: ["color"] });
    expect(colour.status).toBe("llm_variant");
    expect(colour.comparable).toBe(true);
    const unknown = applyLlmDecision(listing, { verdict: "variant", confidence: 0.9, reason: "?" });
    expect(unknown.differs).toEqual(["other"]);
    expect(unknown.comparable).toBe(false);
  });
  it("never overrides a model-number decision", () => {
    const sku = matchListing({ modelNumber: "ILCE-7M4", variant: {} }, {
      source: "a", url: "https://a.sg", title: "Sony ILCE-7M4 body", priceText: "S$3,000",
    });
    expect(applyLlmDecision(sku, { verdict: "different", confidence: 1, reason: "x" }).status).toBe("same");
  });
});

describe("groupListings", () => {
  it("groups by status and sorts cheapest first", () => {
    const target = { modelNumber: "ILCE-7M4", variant: {} };
    const mk = (title: string, priceText: string) =>
      matchListing(target, { source: "s", url: "https://s.sg", title, priceText });
    const groups = groupListings([
      mk("Sony ILCE-7M4 body", "S$3,200"),
      mk("Sony ILCE-7M4 body", "S$3,000"),
      mk("Sony ILCE-7M3 body", "S$1,900"),
      mk("Sony A7 IV body", "S$2,700"),
    ]);
    expect(groups.matched.map((l) => l.price)).toEqual([3000, 3200]);
    expect(groups.different).toHaveLength(1);
    expect(groups.unconfirmed).toHaveLength(1);
  });
});

describe("quota", () => {
  const morning = new Date("2026-10-07T01:00:00Z"); // 09:00 SGT
  const nextDay = new Date("2026-10-07T16:30:00Z"); // 00:30 SGT next day

  it("rolls over at Singapore midnight", () => {
    expect(sgDay(morning)).toBe("2026-10-07");
    expect(sgDay(nextDay)).toBe("2026-10-08");
    const used = consume(emptyQuota(morning), "firecrawl");
    expect(currentQuota(used, nextDay).used.firecrawl).toBe(0);
  });
  it("refuses once the daily limit is reached", () => {
    let state = emptyQuota(morning);
    const limits = { firecrawl: 2, jina: 1, browser: 1 };
    state = consume(consume(state, "firecrawl"), "firecrawl");
    expect(canUse(state, "firecrawl", "watch", limits)).toBe(false);
    expect(canUse(state, "jina", "watch", limits)).toBe(true);
    expect(remaining(state, "watch", limits)).toEqual({ firecrawl: 0, jina: 1, browser: 1 });
  });
  it("keeps 30% of each limit for watchlist re-checks", () => {
    const limits = { firecrawl: 10, jina: 10, browser: 10 };
    let state = emptyQuota(morning);
    for (let i = 0; i < 7; i++) state = consume(state, "firecrawl");
    expect(canUse(state, "firecrawl", "search", limits)).toBe(false);
    expect(canUse(state, "firecrawl", "watch", limits)).toBe(true);
    expect(remaining(state, "search", limits).firecrawl).toBe(0);
    expect(remaining(state, "watch", limits).firecrawl).toBe(3);
  });
  it("starts fresh when saved counts use tool names that no longer exist", () => {
    const old = { day: sgDay(morning), used: { brave: 5, tavily: 2, browser: 1 } } as unknown as QuotaState;
    expect(currentQuota(old, morning)).toEqual(emptyQuota(morning));
  });
  it("gives new searches 70% of the real daily limits by default", () => {
    expect(remaining(emptyQuota(morning))).toEqual({ firecrawl: 21, jina: 70, browser: 14 });
  });
});

describe("search requests", () => {
  it("accepts a model or a category search and trims the text", () => {
    expect(parseResearchInput({ mode: "category", query: "  27-inch 4K monitor ", description: "", priorities: "" })).toEqual({
      ok: true,
      value: { mode: "category", query: "27-inch 4K monitor", description: "", priorities: "" },
    });
    expect(parseResearchInput({ query: "Sony WH-1000XM6" })).toMatchObject({ ok: true, value: { mode: "model" } });
  });
  it("rejects an unknown mode or an empty query", () => {
    expect(parseResearchInput({ mode: "flights", query: "SIN-NRT" })).toEqual({ ok: false, reason: "choose a model or a category search" });
    expect(parseResearchInput({ mode: "category", query: "  " })).toEqual({ ok: false, reason: "enter a category" });
    expect(parseResearchInput(null)).toEqual({ ok: false, reason: "enter a product" });
  });
});

describe("candidate picks", () => {
  const plenty = { firecrawl: 28, jina: 70, browser: 14 };
  it("allows one or two picks from the list", () => {
    expect(checkPicks([0, 2], 3, plenty)).toEqual({ ok: true, value: [0, 2] });
    expect(checkPicks([1, 1], 3, plenty)).toEqual({ ok: true, value: [1] });
  });
  it("refuses more than two, none, or a pick outside the list", () => {
    expect(checkPicks([0, 1, 2], 3, plenty)).toEqual({ ok: false, reason: "pick at most 2 products" });
    expect(checkPicks([], 3, plenty)).toEqual({ ok: false, reason: "pick at least one product" });
    expect(checkPicks([5], 3, plenty)).toEqual({ ok: false, reason: "that product is no longer in the list" });
    expect(checkPicks("0", 3, plenty)).toEqual({ ok: false, reason: "pick at least one product" });
  });
  it("refuses when today's search share can't pay for every pick", () => {
    expect(checkPicks([0, 1], 3, { firecrawl: 7, jina: 70, browser: 14 })).toEqual({
      ok: false,
      reason: "today's search budget covers 1 more product; pick 1",
    });
    expect(checkPicks([0], 3, { firecrawl: 2, jina: 70, browser: 14 })).toEqual({
      ok: false,
      reason: "today's search budget is used up; try again tomorrow",
    });
  });
});
