import type { ZodType } from 'zod'

import { reportBannedTerms } from '@/lib/i18n/banned-terms'
import { bandOf } from '@/lib/constants/curated-products'
import { descriptionMentionsTaiwan } from '@/lib/services/curated-products/origin-qualification'
import { AcquisitionPlan, MAX_FETCH_TARGETS } from '@/lib/services/enrich-phases/acquisition/plan'
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

/**
 * Share of proposals on origin-stated pages whose description mentions Taiwan.
 * Proposals on pages without a stated origin are ignored. Returns null (n/a)
 * when the output predates `originStatedUrls` or no proposal sits on an
 * origin-stated page.
 */
export function originWhenSourced(output: ProductsReplayOutput): number | null {
  if (!output.originStatedUrls) return null
  const stated = new Set(output.originStatedUrls)
  const sourced = output.proposals.filter((p) => stated.has(p.officialUrl))
  if (sourced.length === 0) return null
  const mentioning = sourced.filter((p) => descriptionMentionsTaiwan(p.productDescriptionZh))
  return mentioning.length / sourced.length
}

// ---------------------------------------------------------------------------
// Curation golden-set scorers (DEV-1873)
// ---------------------------------------------------------------------------
// The products-phase ones (keepRate, repairPassRate) live in ./product-scorers:
// this module must not import enrich-phases/products (see that file's header).

type PlanLike = {
  surfaces?: unknown
  fanOut?: unknown
}

/*
 * Replay-path limit (DEV-1873 review H4): `planSchemaValid` and
 * `planFetchCapOk` both reduce to `plan != null` on `acquisitionPlanTask`.
 * `submit_plan` and `adoptPlanFromText` reject an invalid or over-cap plan, and
 * `runPlanStage` returns only an accepted plan, so on replay these two scorers
 * measure plan adoption, not schema or cap compliance. They stay meaningful for
 * any caller that hands them a raw plan.
 * Upgrade path: have `runPlanStage` expose the first raw `submit_plan` args
 * (before parsing) and score those instead of the adopted plan.
 */

/**
 * 1 when the plan's fetches (non-skip surfaces + fanOut) stay within
 * `MAX_FETCH_TARGETS`; 0 when `surfaces` or `fanOut` is present but not an
 * array. On replay this measures plan adoption (see the note above).
 */
export function planFetchCapOk(plan: unknown): number {
  if (!plan || typeof plan !== 'object') return 0
  const { surfaces = [], fanOut = [] } = plan as PlanLike
  if (!Array.isArray(surfaces) || !Array.isArray(fanOut)) return 0
  const fetches =
    surfaces.filter((s) => (s as { fetch?: unknown } | null)?.fetch !== 'skip').length + fanOut.length
  return fetches <= MAX_FETCH_TARGETS ? 1 : 0
}

/**
 * 1 when the plan parses as `AcquisitionPlan`, cross-field refine included.
 * On replay this measures plan adoption (see the note above).
 */
export function planSchemaValid(plan: unknown): number {
  if (plan === null || plan === undefined) return 0
  return AcquisitionPlan.safeParse(plan).success ? 1 : 0
}

/** The critique names a recovery action exactly when its verdict is `thin`. */
export function recoveryActionConsistent(output: {
  verdict?: unknown
  recoveryAction?: unknown
}): number {
  const hasAction = output.recoveryAction !== null && output.recoveryAction !== undefined
  return hasAction === (output.verdict === 'thin') ? 1 : 0
}

export function verdictAgreement(
  output: { verdict?: unknown },
  expected: { verdict: unknown },
): number {
  return decisionAgreement(output.verdict, expected.verdict)
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
// Seeded PRNG (module-private)
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let t = seed | 0
  return () => {
    t = (t + 0x6d2b79f5) | 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------
// Bootstrap confidence interval (new)
// ---------------------------------------------------------------------------

export function bootstrapCI(
  values: number[],
  nBoot = 1000,
  alpha = 0.05,
  opts?: { seed?: number },
): { lo: number; hi: number; mean: number } {
  if (values.length === 0) return { lo: 0, hi: 0, mean: 0 }
  const m = mean(values)
  if (nBoot < 2) return { lo: m, hi: m, mean: m }
  const rand = opts?.seed != null ? mulberry32(opts.seed) : Math.random
  const means = Array.from({ length: nBoot }, () => {
    let sum = 0
    for (let i = 0; i < values.length; i++) {
      sum += values[Math.floor(rand() * values.length)]!
    }
    return sum / values.length
  }).sort((a, b) => a - b)
  const loIdx = Math.floor((alpha / 2) * nBoot)
  const hiIdx = Math.floor((1 - alpha / 2) * nBoot) - 1
  return { lo: means[loIdx]!, hi: means[hiIdx]!, mean: m }
}

// ---------------------------------------------------------------------------
// Paired bootstrap CI with sign test (new)
// ---------------------------------------------------------------------------

export function pairedBootstrapCI(
  a: number[],
  b: number[],
  opts?: { nBoot?: number; alpha?: number; seed?: number },
): { lo: number; hi: number; mean: number; signTestP: number } {
  if (a.length !== b.length) {
    throw new Error(`pairedBootstrapCI: a.length (${a.length}) !== b.length (${b.length})`)
  }

  const n = a.length
  const diffs = a.map((v, i) => v - b[i]!)
  const m = mean(diffs)
  const nBoot = opts?.nBoot ?? 1000
  const alpha = opts?.alpha ?? 0.05
  const rand = opts?.seed != null ? mulberry32(opts.seed) : Math.random

  // Bootstrap resampling of paired differences
  const bootMeans = Array.from({ length: nBoot }, () => {
    let sum = 0
    for (let i = 0; i < n; i++) {
      sum += diffs[Math.floor(rand() * n)]!
    }
    return sum / n
  }).sort((a, b) => a - b)

  const loIdx = Math.floor((alpha / 2) * nBoot)
  const hiIdx = Math.floor((1 - alpha / 2) * nBoot) - 1

  // Two-sided exact binomial sign test
  const nonZero = diffs.filter((d) => d !== 0)
  let signTestP: number
  if (nonZero.length === 0) {
    signTestP = 1
  } else {
    const positives = nonZero.filter((d) => d > 0).length
    const negatives = nonZero.length - positives
    const k = nonZero.length
    // P(X >= max(positives, negatives)) where X ~ Binomial(k, 0.5)
    const maxCount = Math.max(positives, negatives)
    let tailP = 0
    for (let i = maxCount; i <= k; i++) {
      tailP += binomialPmf(k, i, 0.5)
    }
    signTestP = Math.min(2 * tailP, 1)
  }

  return { lo: bootMeans[loIdx]!, hi: bootMeans[hiIdx]!, mean: m, signTestP }
}

/** Binomial PMF: C(n, k) * p^k * (1-p)^(n-k) */
function binomialPmf(n: number, k: number, p: number): number {
  // Use log-space to avoid overflow
  let logP = 0
  for (let i = 0; i < k; i++) {
    logP += Math.log(n - i) - Math.log(i + 1)
  }
  logP += k * Math.log(p) + (n - k) * Math.log(1 - p)
  return Math.exp(logP)
}

// ---------------------------------------------------------------------------
// Curried factories (new)
// ---------------------------------------------------------------------------

export function ndcgAt(k: number) {
  return (output: unknown, expected: unknown): number =>
    ndcgAtK(output as string[], expected as GradedItem[], k)
}
