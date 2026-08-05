"use server";

import { runWithAuditContext } from "@/lib/audit/context";
import { headers } from "next/headers";
import { z } from "zod/v3";

import { ensureVisitorHash } from "@/lib/actions/visitor-identity";
import { getClientIpFromHeaders, rateLimit } from "@/lib/security/rate-limiter";
import {
  submitCorrection,
  type SubmitCorrectionResult,
} from "@/lib/services/brand-corrections";

const brandIdSchema = z.string().uuid();
const correctionInputSchema = z.object({
  brandId: brandIdSchema,
  field: z.enum([
    "price_range",
    "product_type",
    "product_tags",
    "purchase_website",
    "purchase_pinkoi",
    "purchase_shopee",
    "social_instagram",
    "social_threads",
    "social_facebook",
  ]),
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

const CORRECTION_RATE_LIMIT = {
  windowMs: 60_000,
  maxRequests: 5,
  prefix: "brand-correction",
} as const;

export type SubmitCorrectionActionInput = z.infer<typeof correctionInputSchema>;

export type SubmitCorrectionActionResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error:
        | "invalid_brand"
        | "invalid_value"
        | "too_many_tags"
        | "unchanged"
        | "already_submitted"
        | "rate_limited"
        | "unavailable";
    };

function getBrandId(input: unknown): unknown {
  if (typeof input !== "object" || input === null) return undefined;
  return "brandId" in input
    ? (input as { brandId?: unknown }).brandId
    : undefined;
}

function mapServiceError(
  code: Extract<SubmitCorrectionResult, { ok: false }>["code"],
): Extract<SubmitCorrectionActionResult, { ok: false }>["error"] {
  if (code === "invalid_field" || code === "invalid_value") {
    return "invalid_value";
  }
  if (code === "not_found") return "invalid_brand";
  if (code === "database_error") return "unavailable";
  return code;
}

export async function submitCorrectionAction(
  input: SubmitCorrectionActionInput,
): Promise<SubmitCorrectionActionResult> {
  return runWithAuditContext({}, async () => {
    const parsedBrandId = brandIdSchema.safeParse(getBrandId(input));
    if (!parsedBrandId.success) return { ok: false, error: "invalid_brand" };

    const parsed = correctionInputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid_value" };

    try {
      const limit = await rateLimit(
        getClientIpFromHeaders(await headers()),
        CORRECTION_RATE_LIMIT,
      );
      if (!limit.allowed) return { ok: false, error: "rate_limited" };

      const result = await submitCorrection({
        ...parsed.data,
        visitorHash: await ensureVisitorHash(),
      });

      if (result.ok) return result;
      return { ok: false, error: mapServiceError(result.code) };
    } catch (error) {
      console.error("[brand-corrections:submit]", error);
      return { ok: false, error: "unavailable" };
    }
  });
}
