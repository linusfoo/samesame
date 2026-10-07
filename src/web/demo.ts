/**
 * Dev-only sample states for reviewing the page without API keys:
 * open /?demo=model, category, compared, running or error. Imported
 * dynamically behind import.meta.env.DEV, so it never ships.
 * Listings go through the real matcher so the page shows real decisions.
 */

import { applyLlmDecision, groupListings, matchListing, type ListingInput, type Target } from "../core/match";
import { pinnedFromRequest } from "../core/listing";
import type { ItemState, ProductResult } from "../worker/agents/item";
import type { AgentTraceEvent } from "../worker/research";

const t0 = Date.now() - 74_000;

const base: ItemState = {
  input: null,
  mode: "model",
  status: "done",
  phase: "Done",
  error: null,
  candidates: null,
  picked: [],
  products: [],
  trace: [],
  startedAt: t0,
  finishedAt: t0 + 72_000,
  quota: null,
  quotaLeft: { firecrawl: 21, jina: 63, browser: 12 },
  sourcesConfigured: { search: true, browser: true, llm: true },
  chat: [],
  chatBusy: false,
};

function product(
  key: string,
  query: string,
  description: string,
  p: ProductResult["product"] & {},
  listings: ListingInput[],
  llm: Record<number, Parameters<typeof applyLlmDecision>[1]> = {},
): ProductResult {
  const target: Target = { modelNumber: p.modelNumber, variant: p.variant, pinned: pinnedFromRequest(query, description) };
  const matched = listings.map((l, i) => {
    const m = matchListing(target, l);
    return llm[i] ? applyLlmDecision(m, llm[i]) : m;
  });
  const groups = groupListings(matched);
  return {
    key,
    query,
    status: "done",
    phase: "Done",
    error: null,
    product: p,
    groups,
    matchedSources: new Set(groups.matched.map((l) => l.source)).size,
    startedAt: t0,
    finishedAt: t0 + 72_000,
  };
}

const sony = product(
  "model",
  "Sony WH-1000XM6 headphones",
  "Black, over-ear",
  { brand: "Sony", name: "WH-1000XM6", modelNumber: "WH-1000XM6/B", variant: { color: "black" } },
  [
    { source: "shopee.sg", url: "https://shopee.sg/demo-1", title: "Sony WH-1000XM6/B Wireless Noise Cancelling Headphones Black | 1 Year Sony Singapore Warranty", priceText: "S$579.00", warranty: "local", shippingText: "Free shipping", vouchers: ["S$15 off min spend S$300"] },
    { source: "amazon.sg", url: "https://amazon.sg/demo-2", title: "Sony WH-1000XM6/B Premium Wireless Headphones, Black", priceText: "S$629.00 S$529.00", shippingText: "Free delivery over S$60" },
    { source: "qoo10.sg", url: "https://qoo10.sg/demo-3", title: "[Export Set] Sony WH-1000XM6/B Headphones Black", priceText: "S$459.00", shippingText: "S$4.00 shipping" },
    { source: "challenger.sg", url: "https://challenger.sg/demo-4", title: "Sony WH-1000XM6 Noise Cancelling Headphones (WH-1000XM6/B)", priceText: "S$599.00", warranty: "local" },
    { source: "lazada.sg", url: "https://lazada.sg/demo-5", title: "SONY WH1000XM6/S Noise Cancelling Headphone - Silver", priceText: "S$549.00", vouchers: ["LazFlash S$20 off"] },
    { source: "harveynorman.com.sg", url: "https://harveynorman.com.sg/demo-6", title: "Sony WH-1000XM6/B Headphones + Travel Case Bundle", priceText: "S$649.00", warranty: "local" },
    { source: "carousell.sg", url: "https://carousell.sg/demo-7", title: "Sony noise cancelling headphones XM6 like new", priceText: "S$380.00" },
    { source: "courts.com.sg", url: "https://courts.com.sg/demo-8", title: "Sony WH-1000XM5 Wireless Headphones Black", priceText: "S$399.00" },
  ],
  { 6: { verdict: "same", confidence: 0.55, reason: "probably the XM6 but the listing never says the model" } },
);

const trace: AgentTraceEvent[] = [
  { agent: "discovery", kind: "model", name: "deepseek", detail: "asked for 1 tool call", ms: 2100, ok: true, at: 2100 },
  { agent: "discovery", kind: "tool", name: "web_search", detail: "Sony WH-1000XM6 price Singapore → 8 results", ms: 900, ok: true, at: 3100 },
  { agent: "discovery", kind: "tool", name: "tavily_search", detail: "WH-1000XM6 Qoo10 Challenger → 5 results", ms: 1400, ok: true, at: 6200 },
  { agent: "discovery", kind: "tool", name: "read_page", detail: "amazon.sg: extraction failed, used the browser", ms: 5200, ok: false, at: 12000 },
  { agent: "discovery", kind: "submit", name: "submit_result", detail: "8 listings", ms: 0, ok: true, at: 31000 },
  { agent: "matcher", kind: "submit", name: "submit_result", detail: "1 decision", ms: 0, ok: true, at: 38000 },
];

const monitorCandidates = [
  { brand: "Dell", name: "S2722QC", modelNumber: "S2722QC", reason: "4K with USB-C power, often under S$450 with local warranty" },
  { brand: "LG", name: "UltraFine 27UP850N", modelNumber: "27UP850N-W", reason: "Good colour accuracy for photo work, USB-C 96W" },
  { brand: "Dell", name: "UltraSharp U2723QE", modelNumber: "U2723QE", reason: "Best panel here, but usually around S$800" },
  { brand: "Gigabyte", name: "M27U", modelNumber: "M27U", reason: "Cheapest 4K with USB-C, 160Hz for games too" },
];

const monitorInput = {
  mode: "category" as const,
  query: "27-inch 4K monitor",
  description: "Photo editing and office work, USB-C would be nice",
  priorities: "Under S$700, local warranty",
};

const dell = product(
  "c0",
  "Dell S2722QC",
  monitorInput.description,
  { brand: "Dell", name: "S2722QC", modelNumber: "S2722QC", variant: {} },
  [
    { source: "dell.com/en-sg", url: "https://dell.com/demo-d1", title: "Dell 27 4K UHD USB-C Monitor - S2722QC", priceText: "S$479.00", warranty: "local", shippingText: "Free delivery" },
    { source: "shopee.sg", url: "https://shopee.sg/demo-d2", title: "Dell S2722QC 27\" 4K USB-C Monitor 3 Years Local Warranty", priceText: "S$429.00", warranty: "local", vouchers: ["S$10 off"] },
    { source: "lazada.sg", url: "https://lazada.sg/demo-d3", title: "DELL S2722QC 27 inch 4K UHD Monitor", priceText: "S$445.00" },
    { source: "challenger.sg", url: "https://challenger.sg/demo-d4", title: "Dell S2722QC 27\" 4K Monitor", priceText: "S$469.00", warranty: "local" },
  ],
);

const lg = product(
  "c1",
  "LG UltraFine 27UP850N 27UP850N-W",
  monitorInput.description,
  { brand: "LG", name: "UltraFine 27UP850N", modelNumber: "27UP850N-W", variant: {} },
  [
    { source: "courts.com.sg", url: "https://courts.com.sg/demo-l1", title: "LG 27UP850N-W 27\" UHD 4K UltraFine Monitor", priceText: "S$599.00", warranty: "local" },
    { source: "amazon.sg", url: "https://amazon.sg/demo-l2", title: "LG 27UP850N-W 27 Inch UltraFine UHD IPS USB-C Monitor", priceText: "S$549.00", shippingText: "Free delivery" },
  ],
);

export const DEMOS: Record<string, ItemState> = {
  model: {
    ...base,
    input: { mode: "model", query: "Sony WH-1000XM6 headphones", description: "Black, over-ear", priorities: "Local warranty, cheapest new unit" },
    products: [sony],
    trace,
  },
  category: {
    ...base,
    mode: "category",
    status: "choosing",
    phase: "Found 4 models",
    input: monitorInput,
    candidates: monitorCandidates,
  },
  compared: {
    ...base,
    mode: "category",
    input: monitorInput,
    candidates: monitorCandidates,
    picked: [0, 1],
    products: [dell, lg],
  },
  running: {
    ...base,
    mode: "category",
    status: "running",
    phase: "Comparing 2 models",
    input: monitorInput,
    candidates: monitorCandidates,
    picked: [0, 1],
    finishedAt: null,
    startedAt: Date.now() - 23_000,
    products: [
      { ...dell, status: "running", phase: "Searching Singapore shops", product: null, groups: null, matchedSources: 0, finishedAt: null },
      { ...lg, status: "running", phase: "Asking the LLM about 2 listing(s) without a model number", product: null, groups: null, matchedSources: 0, finishedAt: null },
    ],
    trace: trace.slice(0, 3),
  },
  error: {
    ...base,
    status: "error",
    phase: "Failed",
    error: "Discovery failed: the model stopped without submitting a result twice.",
    input: { mode: "model", query: "Sony WH-1000XM6 headphones", description: "", priorities: "" },
    sourcesConfigured: { search: true, browser: false, llm: true },
  },
};
