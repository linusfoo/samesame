/**
 * Decide whether a listing is the product the shopper asked for.
 *
 * Model numbers decide first. Listings without a usable model number are
 * marked "needs_llm" and handed to the LLM matcher; its answer is merged
 * back with applyLlmDecision.
 */

import { extractModelCodes, looksRelated, parseModelCode, sameFamily } from "./sku";
import {
  detectBundle,
  detectCondition,
  detectVariant,
  detectWarranty,
  variantDifferences,
  type Condition,
  type Pinned,
  type Variant,
  type VariantField,
  type Warranty,
} from "./listing";
import { parsePrice, type Currency } from "./price";

export type Target = {
  modelNumber: string | null;
  variant: Variant;
  /** Variant fields the shopper asked for by name; other values of these don't count. */
  pinned?: Pinned;
};

/** How a variant listing differs from the target. "other" never counts. */
export type Difference = VariantField | "other";

const NOT_PINNED: Pinned = { storage: false, size: false };

export type ListingInput = {
  source: string;
  url: string;
  title: string;
  priceText?: string;
  modelNumber?: string | null;
  condition?: Condition | "unknown";
  warranty?: Warranty;
  isBundle?: boolean;
  variant?: Variant;
  /** Shown beside the price for the shopper to weigh; never added to it. */
  shippingText?: string;
  vouchers?: string[];
};

export type MatchStatus =
  | "same" // model number matches, same variant
  | "variant" // model number matches, different colour/storage/etc.
  | "different" // a different model from the same range
  | "needs_llm" // no usable model number; the LLM must decide
  | "llm_same" // LLM says same product
  | "llm_variant" // LLM says same product, different variant
  | "unconfirmed"; // LLM unsure or says no

export type MatchedListing = ListingInput & {
  status: MatchStatus;
  reason: string;
  confidence: number | null;
  price: number | null;
  originalPrice: number | null;
  currency: Currency | null;
  condition: Condition;
  warranty: Warranty;
  isBundle: boolean;
  variant: Variant;
  shippingText: string;
  vouchers: string[];
  /** For variants: what differs from the target. */
  differs: Difference[];
  pinned: Pinned;
  /**
   * True when it counts toward the verdict: new, not a bundle, priced in SGD,
   * and the same item or a variant differing only in colour or an unpinned
   * storage/size.
   */
  comparable: boolean;
};

export function matchListing(target: Target, listing: ListingInput): MatchedListing {
  const text = [listing.title, listing.modelNumber ?? ""].join(" ");
  const detected = detectVariant(listing.title);
  const variant = { ...detected, ...stripEmpty(listing.variant) };
  const price = parsePrice(listing.priceText ?? "");

  const base = {
    ...listing,
    price: price.amount,
    originalPrice: price.original,
    currency: price.currency,
    condition:
      !listing.condition || listing.condition === "unknown"
        ? detectCondition(text)
        : listing.condition,
    warranty:
      !listing.warranty || listing.warranty === "unknown"
        ? detectWarranty(text)
        : listing.warranty,
    isBundle: listing.isBundle ?? detectBundle(listing.title),
    variant,
    shippingText: listing.shippingText?.trim() ?? "",
    vouchers: (listing.vouchers ?? []).map((v) => v.trim()).filter(Boolean).slice(0, 3),
    confidence: null,
    pinned: target.pinned ?? NOT_PINNED,
  };

  const decision = decideByModelNumber(target, text, variant);
  return finish({ ...base, ...decision });
}

function decideByModelNumber(
  target: Target,
  text: string,
  variant: Variant,
): { status: MatchStatus; reason: string; differs: Difference[] } {
  const targetCode = target.modelNumber ? parseModelCode(target.modelNumber) : null;
  if (!targetCode) {
    return { status: "needs_llm", reason: "no target model number to compare", differs: [] };
  }

  const codes = extractModelCodes(text);
  const hit = codes.find((c) => sameFamily(c.family, targetCode.family));
  if (hit) {
    const diffs = variantDifferences(normaliseVariant(target.variant), variant);
    // Suffixes are colour or region codes (the family key strips them), so they count as colour.
    if (hit.suffix && targetCode.suffix && hit.suffix !== targetCode.suffix && !diffs.some((d) => d.field === "color")) {
      diffs.push({ field: "color", text: `model suffix /${hit.suffix} vs /${targetCode.suffix}` });
    }
    if (diffs.length > 0) {
      return {
        status: "variant",
        reason: `${hit.raw}: ${diffs.map((d) => d.text).join(", ")}`,
        differs: diffs.map((d) => d.field),
      };
    }
    return { status: "same", reason: `model number ${hit.raw} matches`, differs: [] };
  }

  const sibling = codes.find((c) => looksRelated(c.family, targetCode.family));
  if (sibling) {
    return { status: "different", reason: `different model ${sibling.raw}`, differs: [] };
  }
  return { status: "needs_llm", reason: "no model number in listing", differs: [] };
}

export type LlmDecision = {
  verdict: "same" | "variant" | "different" | "unsure";
  confidence: number;
  reason: string;
  /** For "variant": what differs. Missing means unknown, which never counts. */
  differs?: Difference[];
};

/** Confidence below this is shown as unconfirmed rather than LLM-matched. */
export const LLM_CONFIDENCE_FLOOR = 0.7;

export function applyLlmDecision(listing: MatchedListing, decision: LlmDecision): MatchedListing {
  if (listing.status !== "needs_llm") return listing;
  let status: MatchStatus = "unconfirmed";
  if (decision.confidence >= LLM_CONFIDENCE_FLOOR) {
    if (decision.verdict === "same") status = "llm_same";
    else if (decision.verdict === "variant") status = "llm_variant";
    else if (decision.verdict === "different") status = "different";
  }
  return finish({
    ...listing,
    status,
    confidence: decision.confidence,
    reason: `LLM: ${decision.reason}`,
    differs: status === "llm_variant" ? (decision.differs?.length ? decision.differs : ["other"]) : [],
  });
}

/** A variant counts when every difference is colour or a storage/size the shopper left open. */
export function variantCounts(differs: Difference[], pinned: Pinned): boolean {
  return differs.every(
    (d) => d === "color" || (d === "storage" && !pinned.storage) || (d === "size" && !pinned.size),
  );
}

function finish(listing: Omit<MatchedListing, "comparable">): MatchedListing {
  const sameProduct = listing.status === "same" || listing.status === "llm_same";
  const countedVariant =
    (listing.status === "variant" || listing.status === "llm_variant") &&
    variantCounts(listing.differs, listing.pinned);
  return {
    ...listing,
    comparable:
      (sameProduct || countedVariant) &&
      !listing.isBundle &&
      listing.condition === "new" &&
      listing.currency === "SGD" &&
      listing.price !== null,
  };
}

function normaliseVariant(v: Variant): Variant {
  return {
    ...(v.color ? { color: v.color.toLowerCase().replace("grey", "gray") } : {}),
    ...(v.storage ? { storage: v.storage.toUpperCase().replace(/\s/g, "") } : {}),
    ...(v.size ? { size: v.size.toLowerCase().replace(/\s|-?inch(es)?|"/g, "").replace(/(in)?$/, "in") } : {}),
  };
}

function stripEmpty(v: Variant | undefined): Variant {
  if (!v) return {};
  return Object.fromEntries(Object.entries(v).filter(([, x]) => x)) as Variant;
}

export type MatchGroups = Record<"matched" | "variants" | "unconfirmed" | "different", MatchedListing[]>;

/** Group for display, cheapest first within each group. */
export function groupListings(listings: MatchedListing[]): MatchGroups {
  const groups: MatchGroups = { matched: [], variants: [], unconfirmed: [], different: [] };
  for (const l of listings) {
    if (l.status === "same" || l.status === "llm_same") groups.matched.push(l);
    else if (l.status === "variant" || l.status === "llm_variant") groups.variants.push(l);
    else if (l.status === "different") groups.different.push(l);
    else groups.unconfirmed.push(l);
  }
  const byPrice = (a: MatchedListing, b: MatchedListing) =>
    (a.price ?? Infinity) - (b.price ?? Infinity);
  for (const g of Object.values(groups)) g.sort(byPrice);
  return groups;
}
