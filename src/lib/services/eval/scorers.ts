import type { ZodType } from 'zod'

import { reportBannedTerms } from '@/lib/i18n/banned-terms'
import { bandOf } from '@/lib/constants/curated-products'
import { jaccard, pairwiseConcordance, type ProductsReplayOutput, type ProductsExpected } from './products-calibration'

const CJK_ALL_REGEX = /[\u4E00-\u9FFF\u3400-\u4DBF\u3000-\u303F\uFF01-\uFF60\uFE30-\uFE4F]/u
const LATIN_REGEX = /[A-Za-z]/u
const JUNK_IMAGE_TAGS = new Set(['promo', 'text_banner', 'irrelevant'])

export type LanguageLocale = 'zh' | 'en'
export type LengthBand = readonly [min: number, max: number]
export type LabeledImage = {
  url: string
  junk: boolean
}

export function languagePurity(text: string, locale: LanguageLocale): number {
  const chars = Array.from(text).filter((char) => /\S/u.test(char))

  if (chars.length === 0) {
    return 1
  }

  const cjkCount = chars.filter((char) => CJK_ALL_REGEX.test(char)).length
  const latinCount = chars.filter((char) => LATIN_REGEX.test(char)).length
  const scriptChars = cjkCount + latinCount

  if (scriptChars === 0) {
    return 1
  }

  const cjkRatio = cjkCount / scriptChars
  return locale === 'zh' ? cjkRatio : 1 - cjkRatio
}

export function lengthBand(text: string, [min, max]: LengthBand): boolean {
  return text.length >= min && text.length <= max
}

export function classificationPrecision(
  labeled: readonly LabeledImage[],
  predicted: ReadonlyMap<string, string>
): number {
  if (labeled.length === 0) {
    return 1
  }

  const correct = labeled.filter((item) => {
    const tag = predicted.get(item.url)
    const predictedJunk = tag ? JUNK_IMAGE_TAGS.has(tag) : false
    return item.junk === predictedJunk
  }).length

  return correct / labeled.length
}

// ---------------------------------------------------------------------------
// Decision & confidence scorers
// ---------------------------------------------------------------------------

const VALID_BANDS = new Set(['high', 'medium', 'low'])

export function decisionAgreement(output: unknown, expected: unknown): number {
  if (output === undefined) return 0
  return output === expected ? 1 : 0
}

export function confidenceBandAgreement(
  output: string | undefined,
  expected: string,
): number {
  if (output === undefined || !VALID_BANDS.has(output) || !VALID_BANDS.has(expected)) return 0
  return output === expected ? 1 : 0
}

// ---------------------------------------------------------------------------
// Category scorer
// ---------------------------------------------------------------------------

export function categoryAgreement(
  output: { category: string; subcategory?: string | null },
  expected: { category: string; subcategory?: string | null },
): number {
  if (output.category !== expected.category) return 0
  // null subcategory on both sides counts as full match
  if ((output.subcategory ?? null) === (expected.subcategory ?? null)) return 1
  return 0.5
}

// ---------------------------------------------------------------------------
// Write-eligible scorer (rule-injected)
// ---------------------------------------------------------------------------

export function writeEligibleAgreement(
  output: unknown,
  expected: { writeEligible: boolean },
  rule: (output: unknown) => boolean,
): number {
  return rule(output) === expected.writeEligible ? 1 : 0
}

// ---------------------------------------------------------------------------
// Schema compliance scorer
// ---------------------------------------------------------------------------

export function schemaCompliance(output: unknown, schema: ZodType): number {
  const result = schema.safeParse(output)
  return result.success ? 1 : 0
}

// ---------------------------------------------------------------------------
// Banned-term scorer
// ---------------------------------------------------------------------------

export function bannedTermScore(fields: Record<string, string>): number {
  const tuples = Object.entries(fields).map(
    ([field, value]) => [field, value] as const,
  )
  const hits = reportBannedTerms({ summary: {} }, tuples)
  return hits.length === 0 ? 1 : 0
}

// ---------------------------------------------------------------------------
// Product ranking scorers (DEV-1695)
// ---------------------------------------------------------------------------

/**
 * Mean band match: for each expected decision with an `approvedBand`, checks
 * whether `bandOf(output score)` agrees. Missing evaluation → 0.
 */
export function bandAgreement(
  output: ProductsReplayOutput,
  expected: ProductsExpected,
): number {
  const withBand = expected.decisions.filter((d) => d.approvedBand !== undefined)
  if (withBand.length === 0) return 1

  let matches = 0
  for (const decision of withBand) {
    const evaluation = output.evaluations[decision.candidateUrl]
    if (!evaluation) continue
    const predicted = bandOf(evaluation.score)
    if (predicted === decision.approvedBand) matches++
  }

  return matches / withBand.length
}

/**
 * Pairwise concordance over expected `relativeRank` pairs.
 *
 * Output ordering: score DESC, searchPosition ASC — matching production
 * `rankCandidates`. Concordant pairs / total pairs; ties resolved by
 * searchPosition count as concordant.
 *
 * Delegates to pairwiseConcordance (with tie-break enabled).
 */
export function withinPoolOrderingAgreement(
  output: ProductsReplayOutput,
  expected: ProductsExpected,
): number {
  return pairwiseConcordance(output, expected, true)
}

/**
 * Jaccard similarity of output `selected` urls vs expected `selected: true` urls.
 * Both-empty → 1.0.
 */
export function selectionAgreement(
  output: ProductsReplayOutput,
  expected: ProductsExpected,
): number {
  const outputSet = new Set(output.selected)
  const expectedSet = new Set(
    expected.decisions.filter((d) => d.selected).map((d) => d.candidateUrl),
  )
  return jaccard(outputSet, expectedSet)
}
