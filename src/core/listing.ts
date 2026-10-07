/**
 * Read condition, warranty, bundle and variant hints from listing text.
 *
 * Agents also report these fields; the detectors fill in anything the agent
 * left as unknown, so a plain title still yields usable data.
 */

export type Condition = "new" | "refurbished" | "display" | "used";
export type Warranty = "local" | "export" | "parallel_import" | "unknown";

export type Variant = {
  color?: string;
  storage?: string;
  /** Screen or panel size in inches, e.g. "27in". */
  size?: string;
};

export type VariantField = "color" | "storage" | "size";

export type VariantDiff = { field: VariantField; text: string };

export function detectCondition(text: string): Condition {
  const t = text.toLowerCase();
  if (/\b(refurb(ished)?|renewed|reconditioned)\b/.test(t)) return "refurbished";
  if (/\b(display (set|unit)|ex[- ]display|demo (set|unit))\b/.test(t)) return "display";
  if (/\b(used|pre[- ]?owned|second[- ]?hand|2nd hand)\b/.test(t)) return "used";
  return "new";
}

export function detectWarranty(text: string): Warranty {
  const t = text.toLowerCase();
  if (/\bparallel[- ]import(ed)?\b|\bp\.?i\.? set\b/.test(t)) return "parallel_import";
  if (/\b(export set|international (version|set)|intl\.? (version|set)|global version)\b/.test(t)) {
    return "export";
  }
  if (/\b(local set|local warranty|(sg|singapore) (set|warranty)|warranty (in|by) [a-z ]*singapore)\b/.test(t)) {
    return "local";
  }
  return "unknown";
}

export function detectBundle(text: string): boolean {
  const t = text.toLowerCase();
  if (/\b(bundle|combo|lens kit|kit lens|free gift)\b/.test(t)) return true;
  if (/\bwith [a-z0-9 -]*\blens\b/.test(t)) return true;
  // "Black + Free Case", but not "Galaxy S25+ 256GB"
  return /\s\+\s*(free\s+)?[a-z]/.test(t);
}

// Longer names first so "titanium black" wins over "black".
const COLOURS = [
  "titanium silverblue",
  "titanium black",
  "titanium gray",
  "titanium whitesilver",
  "midnight blue",
  "space gray",
  "space grey",
  "silverblue",
  "black",
  "white",
  "silver",
  "blue",
  "navy",
  "midnight",
  "gray",
  "grey",
  "green",
  "pink",
  "red",
  "gold",
  "beige",
  "cream",
  "sand",
  "yellow",
  "purple",
];

export function detectVariant(text: string): Variant {
  const t = text.toLowerCase();
  const variant: Variant = {};

  const colour = COLOURS.find((c) => new RegExp(`\\b${c}\\b`).test(t));
  if (colour) variant.color = colour.replace("grey", "gray");

  // Phones list RAM and storage; storage is the larger figure.
  const sizes = [...t.matchAll(/\b(\d+)\s?(gb|tb)\b/g)].map((m) =>
    m[2] === "tb" ? Number(m[1]) * 1024 : Number(m[1]),
  );
  if (sizes.length > 0) {
    const largest = Math.max(...sizes);
    if (largest >= 32) {
      variant.storage = largest >= 1024 ? `${largest / 1024}TB` : `${largest}GB`;
    }
  }

  // 27", 27-inch, 65 inch, 27in (but not "27 in stock")
  const inches = t.match(/\b(\d{2,3}(?:\.\d)?)(?:\s?(?:"|”|-?\s?inch(?:es)?\b)|in\b)/);
  if (inches) variant.size = `${inches[1]}in`;
  return variant;
}

/** Variant fields that are known on both sides and differ. */
export function variantDifferences(target: Variant, listing: Variant): VariantDiff[] {
  const diffs: VariantDiff[] = [];
  for (const field of ["color", "storage", "size"] as const) {
    const want = target[field];
    const got = listing[field];
    if (want && got && want !== got) {
      diffs.push({ field, text: `${field === "color" ? "colour" : field} ${got} vs ${want}` });
    }
  }
  return diffs;
}

/** Which variant fields the shopper's own words pin down ("512GB", "27-inch"). */
export type Pinned = { storage: boolean; size: boolean };

export function pinnedFromRequest(query: string, description: string): Pinned {
  const v = detectVariant(`${query} ${description}`);
  return { storage: Boolean(v.storage), size: Boolean(v.size) };
}
