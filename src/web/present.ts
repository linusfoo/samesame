/**
 * Pure helpers that turn matched listings into what the page says and draws.
 * No React here, so they can be unit-tested.
 */

import type { MatchedListing } from "../core/match";

export const WARRANTY: Record<MatchedListing["warranty"], string> = {
  local: "Local warranty",
  export: "Export set",
  parallel_import: "Parallel import",
  unknown: "Warranty not stated",
};

const CONDITION: Record<MatchedListing["condition"], string> = {
  new: "new",
  refurbished: "refurbished",
  display: "display unit",
  used: "used",
};

/** "Local warranty, new." */
export function describeUnit(l: MatchedListing): string {
  return `${WARRANTY[l.warranty]}, ${CONDITION[l.condition]}${l.isBundle ? ", sold as a bundle" : ""}.`;
}

/** How the listing was tied to the product, in words the shopper can check. */
export function describeMatch(l: MatchedListing): string {
  if (l.status === "same" || l.status === "variant" || l.status === "different") {
    // Reasons read "model number X matches", "different model X" or "X: colour a vs b".
    const text = /^(model number|different model)/.test(l.reason) ? l.reason : `model number ${l.reason}`;
    return `${text[0].toUpperCase()}${text.slice(1)}.`;
  }
  if (l.confidence === null) return "Not checked yet.";
  const reason = l.reason.replace(/^LLM:\s*/, "");
  return `Matched by name, ${Math.round(l.confidence * 100)}% sure: ${reason}.`;
}

const FIELD: Record<string, string> = { color: "colour", storage: "storage", size: "size", other: "something else" };

/** Why a listing doesn't count toward the comparison, or null when it does. */
export function whyNotCounted(l: MatchedListing): string | null {
  if (l.comparable) return null;
  if (l.status === "unconfirmed" || l.status === "needs_llm") return "not confirmed as this product";
  if (l.status === "different") return "a different product";
  if (l.condition !== "new") return CONDITION[l.condition];
  if (l.isBundle) return "bundle price";
  if (l.price === null) return "no price shown";
  if (l.currency !== "SGD") return `priced in ${l.currency}`;
  const blocking = l.differs.filter(
    (d) => d === "other" || (d === "storage" && l.pinned.storage) || (d === "size" && l.pinned.size),
  );
  if (blocking.length > 0) {
    return blocking.includes("other") ? "differs in a way we couldn't name" : `different ${blocking.map((d) => FIELD[d]).join(" and ")} from what you asked`;
  }
  return "doesn't count";
}

export type RailTag = { listing: MatchedListing; x: number; row: number };

/**
 * Place counting listings on a price rail of `width` px. Tags closer than
 * `minGap` px to the previous tag in a row drop to the next row.
 */
export function railLayout(listings: MatchedListing[], width: number, minGap: number): { tags: RailTag[]; min: number; max: number; rows: number } {
  const priced = listings
    .filter((l): l is MatchedListing & { price: number } => l.comparable && l.price !== null)
    .sort((a, b) => a.price - b.price);
  if (priced.length === 0) return { tags: [], min: 0, max: 0, rows: 0 };
  const min = priced[0].price;
  const max = priced[priced.length - 1].price;
  const span = max - min;
  const lastX: number[] = [];
  const tags = priced.map((listing) => {
    const x = span === 0 ? 0 : ((listing.price - min) / span) * width;
    let row = lastX.findIndex((prev) => x - prev >= minGap);
    if (row === -1) row = lastX.length;
    lastX[row] = x;
    return { listing, x, row };
  });
  return { tags, min, max, rows: lastX.length };
}
