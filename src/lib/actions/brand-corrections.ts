"use server";

import { cookies, headers } from "next/headers";
import { z } from "zod/v3";

import {
  BRAND_LIKE_VISITOR_COOKIE,
  BRAND_LIKE_VISITOR_COOKIE_OPTIONS,
  hashBrandLikeVisitorId,
  signBrandLikeVisitorId,
  verifyBrandLikeVisitorId,
} from "@/lib/security/brand-like-identity";
import { rateLimit } from "@/lib/security/rate-limiter";
import {
  submitCorrection,
  type SubmitCorrectionResult,
} from "@/lib/services/brand-corrections";

const brandIdSchema = z.string().uuid();
const correctionInputSchema = z.object({
  brandId: brandIdSchema,
  field: z.enum(["price_range", "product_type", "product_tags"]),
  proposedValue: z.union([
    z.number(),
    z.string(),
    z.object({
      add: z.array(z.string()),
      remove: z.array(z.string()),
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

async function getRequestIp(): Promise<string> {
  const headerList = await headers();
  return (
    headerList.get("cf-connecting-ip") ??
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headerList.get("x-real-ip") ??
    "unknown"
  );
}

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
  const parsedBrandId = brandIdSchema.safeParse(getBrandId(input));
  if (!parsedBrandId.success) return { ok: false, error: "invalid_brand" };

  const parsed = correctionInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_value" };

  try {
    const limit = await rateLimit(await getRequestIp(), CORRECTION_RATE_LIMIT);
    if (!limit.allowed) return { ok: false, error: "rate_limited" };

    const cookieStore = await cookies();
    let visitorId = await verifyBrandLikeVisitorId(
      cookieStore.get(BRAND_LIKE_VISITOR_COOKIE)?.value,
    );

    if (!visitorId) {
      visitorId = crypto.randomUUID();
      cookieStore.set(
        BRAND_LIKE_VISITOR_COOKIE,
        await signBrandLikeVisitorId(visitorId),
        BRAND_LIKE_VISITOR_COOKIE_OPTIONS,
      );
    }

    const result = await submitCorrection({
      ...parsed.data,
      visitorHash: await hashBrandLikeVisitorId(visitorId),
    });

    if (result.ok) return result;
    return { ok: false, error: mapServiceError(result.code) };
  } catch (error) {
    console.error("[brand-corrections:submit]", error);
    return { ok: false, error: "unavailable" };
  }
}
