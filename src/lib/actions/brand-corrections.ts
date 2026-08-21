"use server";

import { runWithAuditContext } from "@/lib/audit/context";
import { headers } from "next/headers";

import { ensureVisitorHash } from "@/lib/actions/visitor-identity";
import { getClientIpFromHeaders, rateLimit } from "@/lib/security/rate-limiter";
import {
  submitCorrection,
  type SubmitCorrectionResult,
} from "@/lib/services/brand-corrections";
// A `"use server"` module may only export async functions, so the schema lives
// beside it and is asserted on directly by `__tests__/brand-corrections.test.ts`.
import {
  brandIdSchema,
  correctionInputSchema,
  type SubmitCorrectionActionInput,
} from "./brand-corrections-core";
// NOT re-exported. Next wraps every export of a `"use server"` module as a
// server-action reference, so a type re-export becomes a runtime binding that
// does not exist: deployed staging threw
// `ReferenceError: SubmitCorrectionActionInput is not defined` on every request
// that touched this module. Import the type from `./brand-corrections-core`
// instead — that module is not `"use server"` and exports it already.

const CORRECTION_RATE_LIMIT = {
  windowMs: 60_000,
  maxRequests: 5,
  prefix: "brand-correction",
} as const;

export type SubmitCorrectionActionResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error:
        | "invalid_brand"
        | "invalid_value"
        | "too_many_subcategories"
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
