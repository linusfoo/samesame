import { describe, expect, it } from "vitest";
import { extractModelCodes, parseModelCode, sameFamily } from "../src/core/sku";
import { parsePrice } from "../src/core/price";
import { detectVariant } from "../src/core/listing";
import { applyLlmDecision, groupListings, matchListing } from "../src/core/match";
import { canUse, consume, currentQuota, emptyQuota, remaining, sgDay } from "../src/core/quota";

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
    const used = consume(emptyQuota(morning), "brave");
    expect(currentQuota(used, nextDay).used.brave).toBe(0);
  });
  it("refuses once the daily limit is reached", () => {
    let state = emptyQuota(morning);
    const limits = { brave: 2, tavily: 1, browser: 1 };
    state = consume(consume(state, "brave"), "brave");
    expect(canUse(state, "brave", limits)).toBe(false);
    expect(canUse(state, "tavily", limits)).toBe(true);
    expect(remaining(state, limits)).toEqual({ brave: 0, tavily: 1, browser: 1 });
  });
});
