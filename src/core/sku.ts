/**
 * Model number (SKU) extraction and comparison.
 *
 * A model code is split into a family key (which product it is) and an
 * optional suffix (usually colour or region, e.g. the "/B" in "WH-1000XM6/B").
 * Pure functions only; see test/sku.test.ts.
 */

export type ModelCode = {
  raw: string;
  family: string;
  suffix: string | null;
};

// Tokens that look like units or specs rather than model numbers,
// checked after normalising (so "4.1L" is "41L", "28-70mm" is "2870MM").
const UNIT =
  /^\d+(GB|TB|MB|MAH|HZ|KHZ|MM|CM|M|L|ML|KG|G|W|KW|V|IN|INCH|K|P|FPS|MP|X|PCS|YR|YRS)$/;

// If the longer of two codes only adds one of these, it is a different product
// (e.g. RTX4070 vs RTX4070TI, S25 vs S25ULTRA).
const DIFFERENT_PRODUCT_SUFFIX = /^(TI|SUPER|PRO|PLUS|MAX|ULTRA|MINI|LITE|SE|FE)/;

const MIN_CODE_LENGTH = 4;
const MAX_TRAILING_CHARS = 6;

export function normaliseCode(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Parse one model number such as "WH-1000XM6/B", "SM-S938B" or "27GR95QE-B". */
export function parseModelCode(raw: string): ModelCode | null {
  const cleaned = raw.trim().replace(/[.,:;]+$/, "");
  const normalised = normaliseCode(cleaned);
  if (normalised.length < MIN_CODE_LENGTH) return null;
  if (!/[A-Z]/.test(normalised) || !/[0-9]/.test(normalised)) return null;
  if (UNIT.test(normalised)) return null;

  let base = cleaned;
  let suffix: string | null = null;

  const slash = cleaned.indexOf("/");
  if (slash > 0) {
    const after = normaliseCode(cleaned.slice(slash + 1));
    if (after.length >= 1 && after.length <= 4) {
      base = cleaned.slice(0, slash);
      suffix = after;
    }
  } else {
    const dash = cleaned.lastIndexOf("-");
    if (dash > 0) {
      const after = cleaned.slice(dash + 1);
      const before = cleaned.slice(0, dash);
      if (/^[A-Za-z]{1,2}$/.test(after) && /[0-9]/.test(before)) {
        base = before;
        suffix = after.toUpperCase();
      }
    }
  }

  const family = normaliseCode(base);
  if (family.length < MIN_CODE_LENGTH) return null;
  return { raw: cleaned, family, suffix };
}

/** Every plausible model code in a piece of text, deduplicated by family. */
export function extractModelCodes(text: string): ModelCode[] {
  const tokens = text.split(/[\s,()[\]{}|"'+]+/);
  const seen = new Set<string>();
  const codes: ModelCode[] = [];
  for (const token of tokens) {
    const code = parseModelCode(token);
    if (code && !seen.has(code.family)) {
      seen.add(code.family);
      codes.push(code);
    }
  }
  return codes;
}

/**
 * True when two family keys name the same product. One may extend the other
 * with a short colour/region code (SMS938B vs SMS938BZKCXSP), but not with a
 * tier word (RTX4070 vs RTX4070TI).
 */
export function sameFamily(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < MIN_CODE_LENGTH || !long.startsWith(short)) return false;
  const rest = long.slice(short.length);
  if (DIFFERENT_PRODUCT_SUFFIX.test(rest)) return false;
  return rest.length <= MAX_TRAILING_CHARS;
}

/** True when two codes look like siblings from the same maker's range. */
export function looksRelated(a: string, b: string): boolean {
  return a.slice(0, 2) === b.slice(0, 2);
}
