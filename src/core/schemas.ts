/**
 * Shapes the LLM must return through its submit_result tool.
 * Validation errors are fed back to the model once, then the run fails soft.
 */

import { z } from "zod";

export const VariantSchema = z.object({
  color: z.string().optional(),
  storage: z.string().optional(),
  size: z.string().optional().describe('Screen size in inches, e.g. "27in"'),
});

export const ReportedListingSchema = z.object({
  source: z.string().min(1).describe("Shop domain, e.g. shopee.sg"),
  url: z.string().url().describe("Direct link to the product listing"),
  title: z.string().min(1).describe("Listing title as shown by the shop"),
  priceText: z
    .string()
    .describe('Price exactly as shown, with currency, e.g. "S$1,299.00". Empty if not found.'),
  modelNumber: z
    .string()
    .nullable()
    .describe("Manufacturer model number if the listing shows one, else null"),
  condition: z.enum(["new", "refurbished", "display", "used", "unknown"]),
  warranty: z.enum(["local", "export", "parallel_import", "unknown"]),
  isBundle: z.boolean().describe("True if the price includes extra items (case, lens, gifts)"),
  variant: VariantSchema,
});

export const DiscoveryResultSchema = z.object({
  product: z.object({
    brand: z.string(),
    name: z.string(),
    modelNumber: z
      .string()
      .nullable()
      .describe("Canonical manufacturer model number for the requested product, or null if it has none"),
    variant: VariantSchema,
  }),
  listings: z.array(ReportedListingSchema).max(12),
});

export const LlmMatchResultSchema = z.object({
  decisions: z.array(
    z.object({
      index: z.number().int().min(0),
      verdict: z.enum(["same", "variant", "different", "unsure"]),
      confidence: z.number().min(0).max(1),
      reason: z.string(),
      differs: z
        .array(z.enum(["color", "storage", "size", "other"]))
        .default([])
        .describe('For "variant": which of colour, storage, size (or other) differ. Empty otherwise.'),
    }),
  ),
});

export type ReportedListing = z.infer<typeof ReportedListingSchema>;
export type DiscoveryResult = z.infer<typeof DiscoveryResultSchema>;
export type LlmMatchResult = z.infer<typeof LlmMatchResultSchema>;
/** What the model sends; `differs` may be left out. */
export type LlmMatchReply = z.input<typeof LlmMatchResultSchema>;

/** One-line summary of a zod error for the retry message. */
export function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}
