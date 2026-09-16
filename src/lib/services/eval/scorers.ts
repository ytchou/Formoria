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

// ---------------------------------------------------------------------------
// IR metric functions (migrated from scripts/enrichment/eval/search-eval/metrics.ts)
// ---------------------------------------------------------------------------

/**
 * Precision@k: fraction of the top-k retrieved items that are in the expected set.
 */
export function precisionAtK(
  retrieved: string[],
  expected: string[],
  k: number,
): number {
  if (k <= 0) return 0
  const topK = retrieved.slice(0, k)
  const expectedSet = new Set(expected)
  const hits = topK.filter((id) => expectedSet.has(id)).length
  return hits / k
}

/**
 * Recall@k: fraction of expected items found in the top-k retrieved items.
 */
export function recallAtK(
  retrieved: string[],
  expected: string[],
  k: number,
): number {
  if (expected.length === 0) return 0
  const topK = new Set(retrieved.slice(0, k))
  const hits = expected.filter((id) => topK.has(id)).length
  return hits / expected.length
}

/**
 * Mean Reciprocal Rank: 1 / (rank of the first expected item in retrieved).
 * Returns 0 when no expected item appears in retrieved.
 */
export function mrr(retrieved: string[], expected: string[]): number {
  const expectedSet = new Set(expected)
  for (let i = 0; i < retrieved.length; i++) {
    if (expectedSet.has(retrieved[i]!)) {
      return 1 / (i + 1)
    }
  }
  return 0
}

// ---------------------------------------------------------------------------
// Aggregation helpers (migrated from metrics.ts)
// ---------------------------------------------------------------------------

export function p95(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.ceil(sorted.length * 0.95) - 1
  return sorted[Math.max(0, index)]!
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

// ---------------------------------------------------------------------------
// NDCG@k (new)
// ---------------------------------------------------------------------------

export type GradedItem = { key: string; grade: number }

export function ndcgAtK(
  retrieved: string[],
  expected: GradedItem[],
  k: number,
): number {
  if (k <= 0 || expected.length === 0) return 0
  const gradeMap = new Map(expected.map((e) => [e.key, e.grade]))
  const topK = retrieved.slice(0, k)

  // DCG = sum of grade_i / log2(i + 2) for i in 0..k-1  (rank is 1-based, so denominator is log2(rank+1))
  let dcg = 0
  for (let i = 0; i < topK.length; i++) {
    const grade = gradeMap.get(topK[i]!) ?? 0
    dcg += grade / Math.log2(i + 2)
  }

  // IDCG = DCG of perfect ranking (sort expected grades desc, take top k)
  const idealGrades = expected.map((e) => e.grade).sort((a, b) => b - a).slice(0, k)
  let idcg = 0
  for (let i = 0; i < idealGrades.length; i++) {
    idcg += idealGrades[i]! / Math.log2(i + 2)
  }

  return idcg === 0 ? 0 : dcg / idcg
}

// ---------------------------------------------------------------------------
// Bootstrap confidence interval (new)
// ---------------------------------------------------------------------------

export function bootstrapCI(
  values: number[],
  nBoot = 1000,
  alpha = 0.05,
): { lo: number; hi: number; mean: number } {
  if (values.length === 0) return { lo: 0, hi: 0, mean: 0 }
  const m = mean(values)
  if (nBoot < 2) return { lo: m, hi: m, mean: m }
  const means = Array.from({ length: nBoot }, () => {
    let sum = 0
    for (let i = 0; i < values.length; i++) {
      sum += values[Math.floor(Math.random() * values.length)]!
    }
    return sum / values.length
  }).sort((a, b) => a - b)
  const loIdx = Math.floor((alpha / 2) * nBoot)
  const hiIdx = Math.floor((1 - alpha / 2) * nBoot) - 1
  return { lo: means[loIdx]!, hi: means[hiIdx]!, mean: m }
}

// ---------------------------------------------------------------------------
// Curried factories (new)
// ---------------------------------------------------------------------------

export function ndcgAt(k: number) {
  return (output: unknown, expected: unknown): number =>
    ndcgAtK(output as string[], expected as GradedItem[], k)
}

export function precisionAt(k: number) {
  return (output: unknown, expected: unknown): number =>
    precisionAtK(output as string[], expected as string[], k)
}

export function recallAt(k: number) {
  return (output: unknown, expected: unknown): number =>
    recallAtK(output as string[], expected as string[], k)
}
