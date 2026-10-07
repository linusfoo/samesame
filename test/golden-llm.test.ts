/**
 * Scores recorded LLM answers against the human labels in the golden set, so
 * it costs nothing and gives the same result every run. Record them live with
 * `npm run test:live` (test/live/record.test.ts).
 *
 *  - Matcher: every listing the model numbers can't decide, in each of the
 *    recorded runs, must pass `matcherFailure` (no false merges).
 *  - Category: every candidate model proposed must be labelled in-category.
 */

import { describe, expect, it } from "vitest";
import { applyLlmDecision, matchListing } from "../src/core/match";
import { pinnedFromRequest } from "../src/core/listing";
import {
  RUNS,
  candidatesRecordingPath,
  categoryCases,
  findLabelledModel,
  goldenFiles,
  matcherFailure,
  matcherRecordingPath,
  readRecording,
  type CandidatesRecording,
  type MatcherRecording,
} from "./golden-llm";

const RECORD_HINT = "no recording yet: run `npm run test:live` with OPENCODE_API_KEY in .dev.vars";

describe("golden set: LLM matcher", () => {
  for (const { name, golden } of goldenFiles()) {
    const target = { ...golden.target, pinned: pinnedFromRequest(golden.query, "") };
    const pending = golden.listings.filter((l) => l.expect.match === "needs_llm");
    if (pending.length === 0) continue;
    const recording = readRecording<MatcherRecording>(matcherRecordingPath(name));

    describe.skipIf(!recording)(`${golden.query} (${recording ? `${recording.runs.length} runs` : RECORD_HINT})`, () => {
      it(`has ${RUNS} recorded runs`, () => {
        expect(recording!.runs.length).toBeGreaterThanOrEqual(RUNS);
      });
      for (const listing of pending) {
        it(listing.title, () => {
          const { expect: want, ...input } = listing;
          const failures = recording!.runs.flatMap((run, i) => {
            const decision = run[listing.url] ?? { verdict: "unsure" as const, confidence: 0, reason: "no decision returned" };
            const got = applyLlmDecision(matchListing(target, input), decision);
            const why = matcherFailure(want.truth, got.status);
            return why ? [`run ${i + 1}: ${why} (${got.reason})`] : [];
          });
          expect(failures).toEqual([]);
        });
      }
    });
  }
});

describe("golden set: category candidates", () => {
  for (const { name, golden } of categoryCases()) {
    const recording = readRecording<CandidatesRecording>(candidatesRecordingPath(name));

    describe.skipIf(!recording)(`${golden.input.query} (${recording ? "recorded" : RECORD_HINT})`, () => {
      it("proposes only labelled, in-category models", () => {
        const failures = recording!.runs.flatMap((run, i) =>
          run.candidates.flatMap((c) => {
            const label = `${c.brand} ${c.name}${c.modelNumber ? ` (${c.modelNumber})` : ""}`;
            const model = findLabelledModel(c, golden.models);
            if (!model) return [`run ${i + 1}: label this model in ${name}: ${label}`];
            if (!model.inCategory) return [`run ${i + 1}: not in the category: ${label}${model.note ? ` (${model.note})` : ""}`];
            return [];
          }),
        );
        expect(failures).toEqual([]);
      });
    });
  }
});

describe("golden scoring rules", () => {
  it("fails merges of anything that isn't the same product", () => {
    expect(matcherFailure("different", "llm_same")).toMatch(/false merge/);
    expect(matcherFailure("variant", "llm_same")).toMatch(/false merge/);
    expect(matcherFailure("uncertain", "llm_variant")).toMatch(/false merge/);
    expect(matcherFailure("same", "different")).toMatch(/rejected/);
  });
  it("passes correct answers and same-product listings left unconfirmed", () => {
    expect(matcherFailure("same", "llm_same")).toBeNull();
    expect(matcherFailure("variant", "llm_variant")).toBeNull();
    expect(matcherFailure("different", "different")).toBeNull();
    expect(matcherFailure("same", "unconfirmed")).toBeNull();
    expect(matcherFailure("uncertain", "unconfirmed")).toBeNull();
  });
  it("finds labelled models by model number or by name", () => {
    const models = [
      { brand: "LG", name: "UltraGear 27GR95QE", modelNumber: "27GR95QE-B", inCategory: false },
      { brand: "Gigabyte", name: "M27U", modelNumber: "M27U", inCategory: true },
    ];
    expect(findLabelledModel({ brand: "LG", name: "27GR95QE", modelNumber: "27GR95QE", reason: "" }, models)?.inCategory).toBe(false);
    expect(findLabelledModel({ brand: "Gigabyte", name: "M27U", modelNumber: null, reason: "" }, models)?.inCategory).toBe(true);
    expect(findLabelledModel({ brand: "Acer", name: "Nitro XV275K", modelNumber: null, reason: "" }, models)).toBeUndefined();
  });
});
