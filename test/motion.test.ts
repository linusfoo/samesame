import { describe, expect, it } from "vitest";
import { HERO_TAGS, priceRanks, settledAt, slotX, tagPose } from "../src/web/scene/motion";

describe("masthead tag choreography", () => {
  const ranks = priceRanks(HERO_TAGS);
  const scatter = [0, 1, 2, 3, 4];

  it("ranks tags by price, cheapest first", () => {
    expect(ranks).toEqual([3, 0, 4, 1, 2]);
    expect(priceRanks([{ shop: "a", price: 5 }, { shop: "b", price: 5 }])).toEqual([0, 1]);
  });

  it("spaces slots evenly and centres a single tag", () => {
    expect([0, 1, 2].map((s) => slotX(s, 3, 4))).toEqual([-2, 0, 2]);
    expect(slotX(0, 1, 4)).toBe(0);
  });

  it("starts every tag above the rail in its scattered slot", () => {
    for (let i = 0; i < 5; i++) {
      const p = tagPose(i, 0, ranks, scatter, 6);
      expect(p.y).toBe(4);
      expect(p.x).toBeCloseTo(slotX(i, 5, 6));
    }
  });

  it("ends with every tag at rest in price order and only the cheapest lit", () => {
    const end = settledAt(5);
    const poses = HERO_TAGS.map((_, i) => tagPose(i, end, ranks, scatter, 6));
    poses.forEach((p, i) => {
      expect(p.x).toBeCloseTo(slotX(ranks[i], 5, 6));
      expect(p.y).toBeCloseTo(0);
      expect(p.swing).toBeCloseTo(0);
    });
    expect(poses.map((p) => p.glow)).toEqual([0, 1, 0, 0, 0]);
  });

  it("swings a tag against the direction it slides", () => {
    // Tag 0 moves right (slot 0 to 3), so mid-slide it leans back to the left.
    const mid = tagPose(0, 1.7 + 0.5, ranks, scatter, 6);
    expect(mid.swing).toBeLessThan(0);
  });
});
