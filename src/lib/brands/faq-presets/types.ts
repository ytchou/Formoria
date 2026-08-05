import type { CategoryPeerStats } from "@/lib/services/brand-peer-stats";
import type { Brand } from "@/lib/types";

export type EvidenceKey =
  | "mitStatus"
  | "mitStory"
  | "productType"
  | "productTags"
  | "priceRange"
  | "reputationSummary"
  | "foundingYear"
  | "city"
  | "peerStats";

export type FaqTFn = (
  key: string,
  params?: Record<string, unknown>,
) => string;

export type FaqBrandContext = {
  brand: Brand;
  cityLabel?: string | null;
  peerStats?: CategoryPeerStats | null;
};

export type FaqValidationResult = {
  ok: boolean;
  reason?: string;
};

export type FaqValidatorContext = {
  locale: "zh" | "en";
  brand: FaqBrandContext;
  siblings: readonly string[];
};

export type FaqValidator = (
  answer: string,
  ctx: FaqValidatorContext,
) => FaqValidationResult;

export type FaqPreset = {
  id: string;
  eligible: (ctx: FaqBrandContext) => boolean;
  requiredEvidence: readonly EvidenceKey[];
  templateFloor:
    | ((ctx: FaqBrandContext, t: FaqTFn, locale: string) => string)
    | null;
  promptFragment: ((ctx: FaqBrandContext) => string) | null;
  validators: readonly FaqValidator[];
};

/**
 * Page-length guard rail, not a quality target — zero custom questions is a
 * valid result. Lives here rather than in `index.ts` so `custom.ts` can read it
 * without importing the aggregation point back into a preset module.
 */
export const CUSTOM_QUESTION_CEILING = 4;

export function hasValue(value: string | null | undefined): value is string {
  return value != null && value.trim() !== "";
}

export function buildBrandContextSuffix(
  ctx: FaqBrandContext,
  t: FaqTFn,
): string {
  const details = [
    hasValue(ctx.cityLabel)
      ? t("brandFaq.context.city", { city: ctx.cityLabel })
      : null,
    ctx.brand.foundingYear
      ? t("brandFaq.context.founded", { year: ctx.brand.foundingYear })
      : null,
  ].filter((value): value is string => hasValue(value));

  return details.length > 0
    ? t("brandFaq.context.suffix", {
        details: details.join(t("brandFaq.listSeparator")),
      })
    : "";
}
