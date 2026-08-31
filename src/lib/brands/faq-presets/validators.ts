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
  return (
    value.normalize("NFKC").toLocaleLowerCase().match(TOKEN_PATTERN) ?? []
  )
    .map((token) => token.trim())
    .filter(Boolean);
}

function evidencePresent(key: EvidenceKey, ctx: FaqValidatorContext): boolean {
  const { brand } = ctx.brand;
  switch (key) {
    case "categorySlug":
      return (
        typeof brand.categorySlug === "string" &&
        brand.categorySlug.trim() !== ""
      );
    case "subcategories":
      return brand.subcategories.some((tag) => tag.trim() !== "");
    case "foundingYear":
      return brand.foundingYear != null;
    case "city":
      return (
        (ctx.brand.cityLabel?.trim().length ?? 0) > 0 ||
        (brand.city?.trim().length ?? 0) > 0
      );
    case "peerStats":
      return ctx.brand.peerStats != null;
    case "purchaseChannels":
      return (
        (brand.purchaseWebsite?.trim().length ?? 0) > 0 ||
        (brand.purchasePinkoi?.trim().length ?? 0) > 0 ||
        (brand.purchaseShopee?.trim().length ?? 0) > 0 ||
        (brand.purchaseMyship?.trim().length ?? 0) > 0 ||
        (brand.stockistCount ?? 0) > 0
      );
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

  const intersection = [...leftSet].filter((token) =>
    rightSet.has(token),
  ).length;
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
    const measured =
      ctx.locale === "en" ? "x".repeat(wordCount(answer)) : answer;
    return lengthBand(measured, band)
      ? pass()
      : fail("The answer is outside its permitted length band.");
  };
}

export function noCommerceClaims(): FaqValidator {
  return (answer) => {
    const commercePattern =
      /(?:NT\s*[$\uFF04]|TWD|\u65B0\u53F0\u5E63|\d[\d,]*(?:\.\d+)?\s*(?:\u5143|\u584A|NT\s*[$\uFF04]|TWD)|[$\uFF04]\s*\d[\d,]*|\b(?:affordable|budget(?:-friendly)?|mid[- ]?range|premium|luxury|price(?:d|s|point|tier)?|pricing|costs?|stock|inventory|discount|sale|promotion|shipping|delivery|pre-?order|sold out|availability|checkout|cart|offer)\b|\u50F9\u683C|\u552E\u50F9|\u50F9\u4F4D|\u50F9\u9322|\u5E73\u50F9|\u89AA\u6C11|\u5165\u9580\u50F9|\u4E2D\u50F9|\u9AD8\u50F9|\u7CBE\u54C1|\u4FBF\u5B9C|\u6602\u8CB4|\u6298\u6263|\u512A\u60E0|\u4FC3\u92B7|\u7279\u50F9|\u514D\u904B|\u904B\u8CBB|\u5EAB\u5B58|\u73FE\u8CA8|\u7F3A\u8CA8|\u9810\u8CFC|\u552E\u5B8C|\u88DC\u8CA8|\u5230\u8CA8|\u914D\u9001|\u4EA4\u8CA8|\u4F9B\u61C9|\u4E0B\u55AE|\u7D50\u5E33|\u8CFC\u7269\u8ECA)/iu;
    return commercePattern.test(answer)
      ? fail("Commerce claims are not allowed.")
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
    // Scoped to the brand name on purpose. The blanket "no token over the
    // ratio" clause this replaces could not be shipped: it measured *every*
    // multi-character token, and ordinary English function words exceed 8% on
    // their own — "the" runs ~14% of a valid 120–180 word answer, so the
    // clause rejected correct copy rather than stuffed copy. Brand-name
    // repetition is the unambiguous stuffing signal and is what the preamble
    // actually forbids; single characters are not filtered out here because a
    // zh brand name tokenises per Han character and would otherwise be
    // unenforceable.
    const brandTokens = tokens(ctx.brand.brand.name);
    const repeatedBrandName = brandTokens.some(
      (token) =>
        (counts.get(token) ?? 0) / answerTokens.length > maxRepeatRatio,
    );

    return repeatedBrandName
      ? fail("The brand name is repeated too often.")
      : pass();
  };
}

export function groundedIn(evidence: readonly EvidenceKey[]): FaqValidator {
  return (_answer, ctx) => {
    const missing = evidence.find((key) => !evidencePresent(key, ctx));
    return missing ? fail(`Required evidence is missing: ${missing}.`) : pass();
  };
}

export function notDuplicateOf(siblings?: readonly string[]): FaqValidator {
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

export function notGeneric(): FaqValidator {
  return (answer, ctx) => {
    const brand = ctx.brand.brand;
    // Count evidence signals available
    const signals = [
      (brand.material?.length ?? 0) > 0,
      brand.foundingYear != null,
      (brand.city?.trim().length ?? 0) > 0,
      (brand.purchaseWebsite?.trim().length ?? 0) > 0,
      (brand.stockistCount ?? 0) > 0,
    ].filter(Boolean).length;

    // Skip for brands with sparse evidence — false positives are worse
    if (signals < 3) return pass();

    // Strip brand name and city (case-insensitive)
    let stripped = answer;
    const brandName = brand.name;
    if (brandName) {
      stripped = stripped.replace(
        new RegExp(
          brandName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "giu",
        ),
        "",
      );
    }
    const cityLabel = ctx.brand.cityLabel;
    if (cityLabel) {
      stripped = stripped.replace(
        new RegExp(
          cityLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "giu",
        ),
        "",
      );
    }
    const city = brand.city;
    if (city) {
      stripped = stripped.replace(
        new RegExp(city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu"),
        "",
      );
    }

    // Check for brand-specific tokens: years, material slugs, named products,
    // URLs, channel names, place names
    const hasYear = /\b(?:19|20)\d{2}\b/.test(stripped);
    const hasMaterial = (brand.material ?? []).some((m) =>
      stripped.toLowerCase().includes(m.toLowerCase()),
    );
    const hasUrl = /https?:\/\//.test(stripped);
    const hasSpecificClaim = hasYear || hasMaterial || hasUrl;

    // Also check: after stripping, are there enough substantive tokens?
    const substantiveTokens = tokens(stripped);
    const categoryLabel = brand.categoryLabel;
    if (categoryLabel) {
      // Also strip category — it's generic context, not brand-specific
      const categoryTokens = new Set(tokens(categoryLabel));
      const remaining = substantiveTokens.filter(
        (t) => !categoryTokens.has(t),
      );
      if (remaining.length < 5 && !hasSpecificClaim) {
        return fail(
          "The answer contains no brand-specific claims after name and city ablation.",
        );
      }
    } else if (substantiveTokens.length < 5 && !hasSpecificClaim) {
      return fail(
        "The answer contains no brand-specific claims after name and city ablation.",
      );
    }

    return pass();
  };
}

export function composeValidators(...validators: FaqValidator[]): FaqValidator {
  return (answer, ctx) => {
    for (const validator of validators) {
      const result = validator(answer, ctx);
      if (!result.ok) return result;
    }
    return pass();
  };
}
