import {
  languagePurity,
  lengthBand,
  type LengthBand,
} from "@/lib/services/eval/scorers";
import type {
  EvidenceKey,
  FaqValidationResult,
  FaqValidator,
  FaqValidatorContext,
} from "./types";

type Locale = FaqValidatorContext["locale"];
type LengthBands = Partial<Record<Locale, LengthBand>>;

const DEFAULT_LENGTH_BANDS: Record<Locale, LengthBand> = {
  zh: [200, 320],
  en: [120, 180],
};

const TOKEN_PATTERN = /[\p{Script=Han}]|[\p{L}\p{N}]+/gu;

function pass(): FaqValidationResult {
  return { ok: true };
}

function fail(reason: string): FaqValidationResult {
  return { ok: false, reason };
}

function tokens(value: string): string[] {
  return (value.normalize("NFKC").toLocaleLowerCase().match(TOKEN_PATTERN) ?? [])
    .map((token) => token.trim())
    .filter(Boolean);
}

function evidencePresent(
  key: EvidenceKey,
  ctx: FaqValidatorContext,
): boolean {
  const { brand } = ctx.brand;
  switch (key) {
    case "mitStatus":
      // `mit_status` is coerced to "unverified" on read, so an empty string is
      // unreachable and "unverified" is the sentinel for "nothing on file".
      // Evidence exists only once the brand has declared or been verified —
      // the same predicate the legacy `made-in-taiwan` generator used.
      return brand.mitStatus === "declared" || brand.mitStatus === "verified";
    case "mitStory":
      return typeof brand.mitStory === "string" && brand.mitStory.trim() !== "";
    case "productType":
      return typeof brand.productType === "string" && brand.productType.trim() !== "";
    case "productTags":
      return brand.productTags.some((tag) => tag.trim() !== "");
    case "priceRange":
      return brand.priceRange === 1 || brand.priceRange === 2 || brand.priceRange === 3;
    case "reputationSummary":
      return (
        (brand.reputationSummary?.text?.trim().length ?? 0) >= 10 ||
        (brand.reputationSummary?.textEn?.trim().length ?? 0) >= 10
      );
    case "foundingYear":
      return brand.foundingYear != null;
    case "city":
      return (
        (ctx.brand.cityLabel?.trim().length ?? 0) > 0 ||
        (brand.city?.trim().length ?? 0) > 0
      );
    case "peerStats":
      return ctx.brand.peerStats != null;
  }
}

function wordCount(value: string): number {
  const trimmed = value.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/u).length;
}

function jaccard(left: readonly string[], right: readonly string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size === 0 && rightSet.size === 0) return 1;
  if (leftSet.size === 0 || rightSet.size === 0) return 0;

  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  return intersection / new Set([...leftSet, ...rightSet]).size;
}

export function pureLanguage(minScore = 0.9): FaqValidator {
  return (answer, ctx) =>
    languagePurity(answer, ctx.locale) >= minScore
      ? pass()
      : fail("The answer does not stay in the requested language.");
}

export function withinLengthBand(bands: LengthBands = {}): FaqValidator {
  return (answer, ctx) => {
    const band = bands[ctx.locale] ?? DEFAULT_LENGTH_BANDS[ctx.locale];
    // lengthBand measures string length; use one surrogate character per word
    // for English so its word-count band is enforced without changing scorers.
    const measured = ctx.locale === "en" ? "x".repeat(wordCount(answer)) : answer;
    return lengthBand(measured, band)
      ? pass()
      : fail("The answer is outside its permitted length band.");
  };
}

export function noPricingFigures(): FaqValidator {
  return (answer) => {
    const pricingPattern =
      /(?:NT\s*[$＄]|TWD|新台幣|\d[\d,]*(?:\.\d+)?\s*(?:元|塊|NT\s*[$＄]|TWD)|[$＄]\s*\d[\d,]*)/iu;
    return pricingPattern.test(answer)
      ? fail("Pricing figures and currency tokens are not allowed.")
      : pass();
  };
}

export function noKeywordStuffing(maxRepeatRatio = 0.08): FaqValidator {
  return (answer, ctx) => {
    const answerTokens = tokens(answer);
    if (answerTokens.length === 0) return pass();

    const counts = new Map<string, number>();
    for (const token of answerTokens) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
    const brandTokens = tokens(ctx.brand.brand.name);
    const repeatedBrandName = brandTokens.some(
      (token) => (counts.get(token) ?? 0) / answerTokens.length > maxRepeatRatio,
    );
    // Single characters are excluded: zh tokenises per Han character, so
    // ordinary function words (的、是、在) would otherwise trip every answer.
    const repeatedToken = [...counts.entries()].some(
      ([token, count]) =>
        token.length > 1 && count / answerTokens.length > maxRepeatRatio,
    );

    return repeatedBrandName || repeatedToken
      ? fail("A brand name or token is repeated too often.")
      : pass();
  };
}

export function groundedIn(evidence: readonly EvidenceKey[]): FaqValidator {
  return (_answer, ctx) => {
    const missing = evidence.find((key) => !evidencePresent(key, ctx));
    return missing
      ? fail(`Required evidence is missing: ${missing}.`)
      : pass();
  };
}

export function notDuplicateOf(
  siblings?: readonly string[],
): FaqValidator {
  return (answer, ctx) => {
    const candidate = tokens(answer);
    const comparison = siblings ?? ctx.siblings;
    const duplicate = comparison.some(
      (sibling) => jaccard(candidate, tokens(sibling)) > 0.6,
    );
    return duplicate
      ? fail("The answer is too similar to another FAQ answer.")
      : pass();
  };
}

export function composeValidators(
  ...validators: FaqValidator[]
): FaqValidator {
  return (answer, ctx) => {
    for (const validator of validators) {
      const result = validator(answer, ctx);
      if (!result.ok) return result;
    }
    return pass();
  };
}
