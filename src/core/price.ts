/**
 * Parse a price out of listing text, Singapore-first.
 *
 * Handles "S$1,299.00", "SGD 1299", "$1299" (taken as SGD on SG sites),
 * strike-through pairs ("S$1,599 S$1,299" -> 1299, original 1599), and skips
 * shipping, savings and instalment amounts. Non-SGD prices keep their
 * currency and are never silently treated as SGD.
 */

export type Currency = "SGD" | "USD" | "OTHER";

export type ParsedPrice = {
  amount: number | null;
  original: number | null;
  currency: Currency | null;
};

const MONEY =
  /(S\$|SGD|US\$|USD|RM|MYR|€|EUR|£|GBP|\$)\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/gi;

const SKIP_BEFORE = /(save|off|shipping|delivery|\+|from|\bx|instal+ments?(?: of)?)\s*$/i;
const SKIP_AFTER = /^\s*(off|shipping|delivery|\/\s*mo|per month|x\s*\d|monthly)/i;

function currencyOf(symbol: string): Currency {
  const s = symbol.toUpperCase();
  if (s === "S$" || s === "SGD" || s === "$") return "SGD";
  if (s === "US$" || s === "USD") return "USD";
  return "OTHER";
}

export function parsePrice(text: string): ParsedPrice {
  const found: { amount: number; currency: Currency }[] = [];
  for (const m of text.matchAll(MONEY)) {
    const start = m.index ?? 0;
    const before = text.slice(Math.max(0, start - 24), start);
    const after = text.slice(start + m[0].length, start + m[0].length + 14);
    if (SKIP_BEFORE.test(before) || SKIP_AFTER.test(after)) continue;
    const amount = Number(m[2].replace(/,/g, ""));
    if (amount > 0) found.push({ amount, currency: currencyOf(m[1]) });
  }

  if (found.length === 0) return { amount: null, original: null, currency: null };

  const sgd = found.filter((f) => f.currency === "SGD");
  if (sgd.length === 0) {
    // Only foreign prices: report the currency, never a converted guess.
    return { amount: found[0].amount, original: null, currency: found[0].currency };
  }

  const amounts = sgd.map((f) => f.amount);
  const amount = Math.min(...amounts);
  const highest = Math.max(...amounts);
  return { amount, original: highest > amount ? highest : null, currency: "SGD" };
}

export function formatSgd(amount: number | null): string {
  if (amount === null) return "—";
  return `S$${amount.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
