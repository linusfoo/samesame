/**
 * Shared by the golden LLM test (scores recordings) and the live recorder
 * (makes them): file locations, recording shapes and the pass rules.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { MatchStatus, ListingInput, Target } from "../src/core/match";
import type { ResearchInput } from "../src/core/request";
import type { Candidate } from "../src/core/schemas";
import { normaliseCode, parseModelCode, sameFamily } from "../src/core/sku";
import type { LlmDecision } from "../src/core/match";

export const GOLDEN_DIR = join(__dirname, "fixtures", "golden");
export const LLM_DIR = join(GOLDEN_DIR, "llm");
export const CATEGORY_DIR = join(GOLDEN_DIR, "category");

/** The brief's pass mark: three live runs in a row. */
export const RUNS = 3;

export type Truth = "same" | "variant" | "different" | "uncertain";

export type GoldenListing = ListingInput & { expect: { match: string; truth: Truth } & Record<string, unknown> };
export type GoldenFile = { query: string; target: Target; listings: GoldenListing[] };

export type CategoryCase = {
  input: ResearchInput;
  models: { brand: string; name: string; modelNumber: string | null; inCategory: boolean; note?: string }[];
};

export type MatcherRecording = {
  model: string;
  recordedAt: string;
  /** One map per run: listing URL → the LLM's decision. */
  runs: Record<string, LlmDecision>[];
};

export type CandidatesRecording = { model: string; recordedAt: string; runs: { candidates: Candidate[] }[] };

export function goldenFiles(): { name: string; golden: GoldenFile }[] {
  return readdirSync(GOLDEN_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ name: f, golden: JSON.parse(readFileSync(join(GOLDEN_DIR, f), "utf8")) as GoldenFile }));
}

export function categoryCases(): { name: string; golden: CategoryCase }[] {
  if (!existsSync(CATEGORY_DIR)) return [];
  return readdirSync(CATEGORY_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ name: f, golden: JSON.parse(readFileSync(join(CATEGORY_DIR, f), "utf8")) as CategoryCase }));
}

export const matcherRecordingPath = (goldenName: string) => join(LLM_DIR, goldenName);
export const candidatesRecordingPath = (caseName: string) => join(LLM_DIR, `category-${caseName}`);

export function readRecording<T>(path: string): T | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null;
}

/**
 * Why an LLM-matched listing fails the pass mark, or null if it passes.
 * Merging something that isn't the same product fails; so does rejecting the
 * same product as "different". Leaving the same product "unconfirmed" passes.
 */
export function matcherFailure(truth: Truth, status: MatchStatus): string | null {
  if (status === "llm_same" && truth !== "same") return `false merge: matched as same, truth is ${truth}`;
  if (status === "llm_variant" && (truth === "different" || truth === "uncertain")) {
    return `false merge: matched as a variant, truth is ${truth}`;
  }
  if (status === "different" && (truth === "same" || truth === "variant")) return `rejected the product: truth is ${truth}`;
  return null;
}

/** The labelled model a proposed candidate refers to, by model number first, then by name. */
export function findLabelledModel(c: Candidate, models: CategoryCase["models"]) {
  const code = c.modelNumber ? parseModelCode(c.modelNumber) : null;
  if (code) {
    const byCode = models.find((m) => {
      const mc = m.modelNumber ? parseModelCode(m.modelNumber) : null;
      return mc && sameFamily(mc.family, code.family);
    });
    if (byCode) return byCode;
  }
  const name = normaliseCode(`${c.brand}${c.name}`);
  return models.find((m) => {
    const labelled = normaliseCode(`${m.brand}${m.name}`);
    return name.includes(labelled) || labelled.includes(name);
  });
}
