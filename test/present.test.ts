import { describe, expect, it } from "vitest";
import { applyLlmDecision, matchListing, type Target } from "../src/core/match";
import { describeMatch, productName, railLayout, whyNotCounted } from "../src/web/present";

const target: Target = { modelNumber: "SM-S938B", variant: { storage: "256GB" }, pinned: { storage: true, size: false } };
const mk = (title: string, priceText: string, url = title) =>
  matchListing(target, { source: "s.sg", url: `https://s.sg/${encodeURIComponent(url)}`, title, priceText });

describe("price rail layout", () => {
  it("places only counting listings, cheapest at 0 and dearest at the full width", () => {
    const { tags, min, max } = railLayout(
      [mk("SM-S938B 256GB", "S$1,500"), mk("SM-S938B 256GB b", "S$1,700"), mk("SM-S938B 256GB + Free Case", "S$1,400")],
      400,
      50,
    );
    expect([min, max]).toEqual([1500, 1700]);
    expect(tags.map((t) => t.x)).toEqual([0, 400]);
  });
  it("drops a tag that would overlap its neighbour to the next row", () => {
    const { tags, rows } = railLayout(
      [mk("SM-S938B 256GB a", "S$1,000"), mk("SM-S938B 256GB b", "S$1,010"), mk("SM-S938B 256GB c", "S$2,000")],
      1000,
      100,
    );
    expect(tags.map((t) => t.row)).toEqual([0, 1, 0]);
    expect(rows).toBe(2);
  });
  it("is empty when nothing counts", () => {
    expect(railLayout([mk("SM-S938B 256GB refurbished", "S$900")], 400, 50).tags).toEqual([]);
  });
});

describe("why a listing doesn't count", () => {
  it("names the reason in plain words", () => {
    expect(whyNotCounted(mk("SM-S938B 256GB", "S$1,500"))).toBeNull();
    expect(whyNotCounted(mk("SM-S938B 512GB", "S$1,800"))).toBe("different storage from what you asked");
    expect(whyNotCounted(mk("SM-S938B 256GB refurbished", "S$900"))).toBe("refurbished");
    expect(whyNotCounted(mk("SM-S938B 256GB bundle", "S$1,600"))).toBe("bundle price");
    expect(whyNotCounted(mk("SM-S938B 256GB", "US$1,099"))).toBe("priced in USD");
    expect(whyNotCounted(mk("Galaxy S25 Ultra", "S$1,500"))).toBe("not confirmed as this product");
  });
  it("shows how an LLM match was made, with its confidence", () => {
    const llm = applyLlmDecision(mk("Galaxy S25 Ultra", "S$1,500"), { verdict: "same", confidence: 0.82, reason: "same name and storage" });
    expect(describeMatch(llm)).toBe("Matched by name, 82% sure: same name and storage.");
    expect(describeMatch(mk("SM-S938B 256GB", "S$1,500"))).toBe("Model number SM-S938B matches.");
    expect(describeMatch(mk("SM-S938B 512GB", "S$1,800"))).toBe("Model number SM-S938B: storage 512GB vs 256GB.");
  });
});

describe("product name", () => {
  it("doesn't repeat a brand the name already starts with", () => {
    expect(productName({ brand: "Sony", name: "Sony WH-1000XM6 Wireless Headphones" })).toBe("Sony WH-1000XM6 Wireless Headphones");
    expect(productName({ brand: "Sony", name: "WH-1000XM6" })).toBe("Sony WH-1000XM6");
    expect(productName({ brand: "", name: "WH-1000XM6" })).toBe("WH-1000XM6");
  });
});

describe("listings naming several models", () => {
  it("say why they aren't confirmed", () => {
    const l = matchListing({ modelNumber: "WH-1000XM6/B", variant: {} }, {
      source: "lazada.sg", url: "https://lazada.sg/x", title: "SONY WH-1000XM6 / WH-1000XM5 Headphone", priceText: "S$393.00",
    });
    expect(describeMatch(l)).toBe("Lists several models (WH-1000XM6, WH-1000XM5); the price may be for another.");
    expect(whyNotCounted(l)).toBe("not confirmed as this product");
  });
});
