/**
 * The three simulated searches, run for real: OpenCode Go, Firecrawl,
 * Jina Reader and Browser Rendering, with keys from .dev.vars. Uses real quota.
 *
 *   npm run test:live
 *
 * Prints a summary per product and checks the story 1 bar: at least three
 * shops matched, at most six tool calls, under five minutes.
 */

import { describe, expect, it } from "vitest";
import { openCodeModel } from "../../src/worker/llm";
import { runResearch, type ResearchInput } from "../../src/worker/research";
import { formatSgd } from "../../src/core/price";
import { liveTools, readDevVars } from "./env";

const PRODUCTS: ResearchInput[] = [
  { mode: "model", query: "Sony WH-1000XM6 headphones", description: "Black, over-ear", priorities: "Local warranty, cheapest new unit" },
  { mode: "model", query: "Dyson V15 Detect Absolute", description: "Cordless stick vacuum", priorities: "Official warranty" },
  { mode: "model", query: "Samsung Galaxy S25 Ultra 256GB Titanium Black", description: "Phone", priorities: "Local set only" },
];

const FIVE_MINUTES = 5 * 60_000;

const env = readDevVars();

describe.skipIf(!env.OPENCODE_API_KEY || !env.FIRECRAWL_API_KEY)("live searches", () => {
  for (const input of PRODUCTS) {
    it(
      input.query,
      async () => {
        const started = Date.now();
        const outcome = await runResearch(input, {
          model: openCodeModel(env.OPENCODE_API_KEY),
          tools: liveTools(env),
        });
        const elapsed = Date.now() - started;
        const toolCalls = outcome.trace.filter((e) => e.kind === "tool" && !e.detail.startsWith("refused")).length;

        console.log(
          [
            `\n=== ${input.query} (${Math.round(elapsed / 1000)}s, ${toolCalls} tool calls) ===`,
            outcome.error ? `ERROR: ${outcome.error}` : `Product: ${outcome.product?.brand} ${outcome.product?.name} [${outcome.product?.modelNumber ?? "no model number"}]`,
            ...outcome.listings.map(
              (l) =>
                `  ${l.status.padEnd(11)} ${(l.price === null ? "—" : l.currency === "SGD" ? formatSgd(l.price) : `${l.currency} ${l.price}`).padEnd(12)} ${l.source.padEnd(20)} ${l.title.slice(0, 70)}`,
            ),
            ...outcome.trace.filter((e) => !e.ok).map((e) => `  ! ${e.agent} ${e.name}: ${e.detail}`),
          ].join("\n"),
        );

        expect(outcome.error).toBeNull();
        expect(toolCalls).toBeLessThanOrEqual(6);
        expect(elapsed).toBeLessThan(FIVE_MINUTES);
        expect(outcome.matchedSources).toBeGreaterThanOrEqual(3);
      },
      FIVE_MINUTES + 30_000,
    );
  }
});
