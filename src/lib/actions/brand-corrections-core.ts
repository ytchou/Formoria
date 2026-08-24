import { z } from "zod/v3";

import { CORRECTION_FIELDS } from "@/lib/services/brand-corrections";

/**
 * Validation half of the brand-correction server action. It lives outside the
 * `"use server"` module because such a module may only export async functions,
 * and the field gate is the part worth asserting on directly — the split keeps
 * the tests exercising real code instead of mocking `@/lib/services/*`, which
 * `scripts/check-test-boundaries.mjs` forbids.
 *
 * `z.enum` is fed the service's own vocabulary rather than a second hand-kept
 * tuple. The tuple it replaces was built with an `as unknown as` assertion, so
 * TypeScript could not report the member it forgot: `material` shipped in the
 * type, the service, the RPC and the DB CHECK while this gate still rejected
 * it, making the whole path unreachable from its only caller.
 */
export const brandIdSchema = z.string().uuid();

export const correctionInputSchema = z.object({
  brandId: brandIdSchema,
  field: z.enum(CORRECTION_FIELDS),
  proposedValue: z.union([
    z.number(),
    z.string(),
    // Payload-size bounds only. The tag rules (ontology match, 2-8 char novel
    // band, blocklist) live in normalizeProposedValue so the client and the
    // server share one implementation — do not restate them here.
    z.object({
      add: z.array(z.string().trim().min(1).max(40)).max(20),
      remove: z.array(z.string().trim().min(1).max(40)).max(20),
    }),
  ]),
});

export type SubmitCorrectionActionInput = z.infer<typeof correctionInputSchema>;
