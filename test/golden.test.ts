import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { matchListing, type ListingInput, type Target } from "../src/core/match";

type GoldenListing = ListingInput & {
  expect: {
    match: string;
    truth: string;
    price: number;
    currency: string;
    condition: string;
    warranty: string;
    isBundle: boolean;
  };
};

type GoldenFile = { query: string; target: Target; listings: GoldenListing[] };

const dir = join(__dirname, "fixtures", "golden");
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

describe("golden set", () => {
  it("has at least six products", () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  for (const file of files) {
    const golden: GoldenFile = JSON.parse(readFileSync(join(dir, file), "utf8"));

    describe(golden.query, () => {
      for (const listing of golden.listings) {
        it(listing.title, () => {
          const { expect: want, ...input } = listing;
          const got = matchListing(golden.target, input);
          expect({
            match: got.status,
            price: got.price,
            currency: got.currency,
            condition: got.condition,
            warranty: got.warranty,
            isBundle: got.isBundle,
          }).toEqual({
            match: want.match,
            price: want.price,
            currency: want.currency,
            condition: want.condition,
            warranty: want.warranty,
            isBundle: want.isBundle,
          });
        });
      }
    });
  }
});
