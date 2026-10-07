/**
 * Follow-up questions about the products a search found.
 *
 * The chat answers from the gathered listings first and may make a few
 * lookups of its own. Everything here is pure: the question check, the text
 * block the model sees, and which cited links are allowed through.
 */

import type { MatchGroups, MatchedListing } from "./match";
import { formatSgd } from "./price";
import type { Checked, ResearchInput } from "./request";
import type { Candidate } from "./schemas";

export const MAX_QUESTION_CHARS = 500;
/** Tool calls one question may make (search or page reads). */
export const CHAT_TOOL_CALLS = 3;
export const CHAT_TIMEOUT_MS = 60_000;
/** Turns kept in the agent's state; older ones drop off. */
export const MAX_TURNS_KEPT = 40;
/** Earlier turns sent to the model with each question. */
export const HISTORY_TURNS = 8;

export type ChatSource = { url: string; label: string };

export type ChatTurn = {
  role: "user" | "assistant";
  text: string;
  at: number;
  sources?: ChatSource[];
  /** The answer could not be produced; text says why. */
  failed?: boolean;
};

/** What the chat can see: the search, its candidates and each researched product. */
export type ChatContext = {
  input: ResearchInput | null;
  candidates: Candidate[] | null;
  products: { name: string; modelNumber: string | null; groups: MatchGroups | null }[];
};

export function parseQuestion(raw: unknown): Checked<string> {
  if (typeof raw !== "string") return { ok: false, reason: "type a question" };
  const text = raw.trim();
  if (!text) return { ok: false, reason: "type a question" };
  if (text.length > MAX_QUESTION_CHARS) {
    return { ok: false, reason: `keep the question under ${MAX_QUESTION_CHARS} characters` };
  }
  return { ok: true, value: text };
}

/** True when there is anything to ask about. */
export function hasChatData(context: ChatContext): boolean {
  return (context.candidates?.length ?? 0) > 0 || context.products.some((p) => p.groups !== null);
}

const GROUP_TITLES: Record<keyof MatchGroups, string> = {
  matched: "Same item",
  variants: "Other colours and sizes",
  unconfirmed: "Not confirmed",
  different: "Different products",
};

const WARRANTY: Record<MatchedListing["warranty"], string> = {
  local: "local warranty",
  export: "export set",
  parallel_import: "parallel import",
  unknown: "warranty not stated",
};

function describeListing(l: MatchedListing): string {
  const price = l.currency === "SGD" || l.currency === null ? formatSgd(l.price) : l.priceText || "no price";
  const variant = Object.values(l.variant).filter(Boolean).join(" ");
  const facts = [
    price,
    l.originalPrice ? `was ${formatSgd(l.originalPrice)}` : null,
    l.condition,
    WARRANTY[l.warranty],
    l.isBundle ? "bundle" : null,
    variant || null,
    l.comparable ? "counts toward the comparison" : "does not count",
    l.shippingText ? `shipping: ${l.shippingText}` : null,
    l.vouchers.length ? `vouchers: ${l.vouchers.join("; ")}` : null,
  ].filter(Boolean);
  return `- ${l.source}: "${l.title}" | ${facts.join(" | ")} | matched: ${l.reason} | ${l.url}`;
}

/**
 * The gathered data as plain text for the model. Titles and shipping text
 * come from shop pages, so the block is marked as data, not instructions.
 */
export function describeForChat(context: ChatContext): string {
  const lines: string[] = [];
  const { input } = context;
  if (input) {
    lines.push(`Shopper searched (${input.mode === "model" ? "a specific model" : "a kind of product"}): ${input.query}`);
    if (input.description) lines.push(`Description: ${input.description}`);
    if (input.priorities) lines.push(`What matters to them: ${input.priorities}`);
  }
  if (context.candidates?.length) {
    lines.push("", "Candidate models suggested:");
    for (const c of context.candidates) {
      lines.push(`- ${c.brand} ${c.name}${c.modelNumber ? ` (${c.modelNumber})` : ""}: ${c.reason}`);
    }
  }
  for (const p of context.products) {
    lines.push("", `Product: ${p.name}${p.modelNumber ? ` (model ${p.modelNumber})` : ""}`);
    if (!p.groups) {
      lines.push("(no listings yet)");
      continue;
    }
    for (const key of Object.keys(GROUP_TITLES) as (keyof MatchGroups)[]) {
      const listings = p.groups[key];
      if (listings.length === 0) continue;
      lines.push(`${GROUP_TITLES[key]}:`);
      for (const l of listings) lines.push(describeListing(l));
    }
  }
  return `<gathered_data>\n${lines.join("\n").trim()}\n</gathered_data>`;
}

/** Every listing URL in the context, with the shop name to show for it. */
export function knownSources(context: ChatContext): Map<string, string> {
  const known = new Map<string, string>();
  for (const p of context.products) {
    if (!p.groups) continue;
    for (const list of Object.values(p.groups)) for (const l of list) known.set(l.url, l.source);
  }
  return known;
}

/** http(s) URLs in a piece of text, e.g. tool output. */
export function extractUrls(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s"'<>)\]]+/g)].map((m) => m[0].replace(/[.,;:]+$/, ""));
}

/**
 * The cited links worth showing: only URLs from the gathered data or seen in
 * this question's tool output, each once. Anything else was made up.
 */
export function keepCitedSources(cited: string[], known: Map<string, string>, seen: Iterable<string>): ChatSource[] {
  const seenSet = new Set(seen);
  const out: ChatSource[] = [];
  for (const raw of cited) {
    const url = raw.trim();
    if (out.some((s) => s.url === url)) continue;
    const label = known.get(url) ?? (seenSet.has(url) ? hostLabel(url) : null);
    if (label) out.push({ url, label });
  }
  return out;
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Add turns and drop the oldest past the cap. */
export function appendTurns(turns: ChatTurn[], ...added: ChatTurn[]): ChatTurn[] {
  return [...turns, ...added].slice(-MAX_TURNS_KEPT);
}

/**
 * The last few answered exchanges, oldest first. A question whose answer
 * failed, or that has no answer yet, is left out with it.
 */
export function recentHistory(turns: ChatTurn[], limit = HISTORY_TURNS): ChatTurn[] {
  const kept: ChatTurn[] = [];
  for (let i = 0; i + 1 < turns.length; i++) {
    const [question, answer] = [turns[i], turns[i + 1]];
    if (question.role === "user" && answer.role === "assistant") {
      if (!answer.failed) kept.push(question, answer);
      i++;
    }
  }
  return kept.slice(-limit);
}
