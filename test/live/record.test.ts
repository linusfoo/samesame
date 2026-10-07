/**
 * Records real LLM answers for the golden set, for test/golden-llm.test.ts to
 * score offline. Uses the OpenCode key from .dev.vars; the category case also
 * uses real search quota (one candidate run, up to 6 tool calls).
 *
 *   npm run test:live
 *
 * Re-record whenever the golden listings, the matcher prompt or the model change.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { matchListing } from "../../src/core/match";
import { pinnedFromRequest } from "../../src/core/listing";
import { LlmMatchResultSchema } from "../../src/core/schemas";
import { runBoundedAgent } from "../../src/worker/agents/subagent";
import { LLM_MODEL, openCodeModel } from "../../src/worker/llm";
import { MATCHER_SYSTEM, matcherPrompt, runCandidates } from "../../src/worker/research";
import {
  LLM_DIR,
  RUNS,
  candidatesRecordingPath,
  categoryCases,
  goldenFiles,
  matcherRecordingPath,
  type CandidatesRecording,
  type MatcherRecording,
} from "../golden-llm";
import { liveTools, readDevVars } from "./env";

const env = readDevVars();
const save = (path: string, data: unknown) => {
  mkdirSync(LLM_DIR, { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
};

describe.skipIf(!env.OPENCODE_API_KEY)("record golden LLM answers", () => {
  for (const { name, golden } of goldenFiles()) {
    const target = { ...golden.target, pinned: pinnedFromRequest(golden.query, "") };
    const pending = golden.listings.filter((l) => matchListing(target, l).status === "needs_llm");
    if (pending.length === 0) continue;

    it(`matcher × ${RUNS}: ${golden.query}`, async () => {
      const recording: MatcherRecording = { model: LLM_MODEL, recordedAt: new Date().toISOString(), runs: [] };
      for (let run = 0; run < RUNS; run++) {
        const result = await runBoundedAgent({
          model: openCodeModel(env.OPENCODE_API_KEY),
          tools: [],
          maxToolCalls: 0,
          system: MATCHER_SYSTEM,
          user: matcherPrompt(golden.query, { brand: "", name: golden.query, variant: golden.target.variant }, pending),
          schema: LlmMatchResultSchema,
          submitDescription: "Submit one decision per listing index.",
        });
        expect(result.ok, result.ok ? "" : result.error).toBe(true);
        if (!result.ok) return;
        recording.runs.push(
          Object.fromEntries(
            result.result.decisions
              .filter((d) => pending[d.index])
              .map((d) => [pending[d.index].url, { verdict: d.verdict, confidence: d.confidence, reason: d.reason, differs: d.differs }]),
          ),
        );
      }
      save(matcherRecordingPath(name), recording);
    }, 180_000);
  }

  for (const { name, golden } of categoryCases()) {
    it.skipIf(!env.SERPER_API_KEY)(`candidates: ${golden.input.query}`, async () => {
      const outcome = await runCandidates(golden.input, {
        model: openCodeModel(env.OPENCODE_API_KEY),
        tools: liveTools(env),
      });
      expect(outcome.error).toBeNull();
      const recording: CandidatesRecording = {
        model: LLM_MODEL,
        recordedAt: new Date().toISOString(),
        runs: [{ candidates: outcome.candidates }],
      };
      save(candidatesRecordingPath(name), recording);
    }, 180_000);
  }
});
