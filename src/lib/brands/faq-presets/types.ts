import type { CategoryPeerStats } from "@/lib/services/brand-peer-stats";
import type { PublicBrandFaqContext } from "@/lib/brands/contracts";

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
  brand: PublicBrandFaqContext;
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

/**
 * What a preset needs in order to render without a stored answer. The question
 * key and the floor travel together deliberately: a floor with no question has
 * nothing to render under, and the pair being one nullable field makes that a
 * type error rather than a silent skip in the render loop.
 */
type FaqRender = {
  /** i18n key of the question shown above the template floor. */
  questionKey: string;
  templateFloor: (ctx: FaqBrandContext, t: FaqTFn, locale: string) => string;
};

export type FaqPreset = {
  id: string;
  /**
   * Render eligibility: can this preset produce a template floor from the
   * evidence available *in the page request path*? That path has no peer
   * stats — they are an enrichment-pipeline concern — so anything requiring
   * them belongs in `authorable`, not here.
   *
   * `locale` is passed because a floor can be renderable in one language and
   * not the other (a brand with zh product tags and no English ones).
   */
  eligible: (ctx: FaqBrandContext, locale?: string) => boolean;
  /**
   * Authoring eligibility: does the model have enough evidence to write this
   * answer? Defaults to `eligible` for presets that need nothing beyond the
   * render evidence. Only presets whose *prompt* leans on evidence the request
   * path lacks (peer stats) need to override it.
   */
  authorable?: (ctx: FaqBrandContext) => boolean;
  requiredEvidence: readonly EvidenceKey[];
  /** `null` for prompt-only presets, which never render a floor. */
  render: FaqRender | null;
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
