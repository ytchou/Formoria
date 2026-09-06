/**
 * Product ranking calibration — pure analysis functions for the eval harness.
 *
 * All functions are pure (no side effects). They consume the replay output
 * shape and the expected golden dataset shape defined below.
 */
import { z } from 'zod'
import {
  bandOf,
  EDITORIAL_BANDS,
  type EditorialBand,
} from '@/lib/constants/curated-products'
import { normalizeProductUrl } from '@/lib/services/enrich-phases/product-candidates'
import type { CuratedProductProposal } from '@/lib/types/enriched-data'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProductsReplayOutput = {
  evaluations: Record<string, { score: number | null; searchPosition: number | null }>
  selected: string[]
  proposals: CuratedProductProposal[]
  agentOutcome: string
}

export type ProductsExpected = {
  decisions: Array<{
    candidateUrl: string
    selected: boolean
    approvedBand?: EditorialBand
    relativeRank?: number
  }>
}

// ---------------------------------------------------------------------------
// Zod schema for expected shape (moved from phase-adapters.ts:101)
// ---------------------------------------------------------------------------

export const productsExpectedSchema = z.object({
  decisions: z.array(z.object({
    candidateUrl: z.string(),
    selected: z.boolean(),
    approvedBand: z.string().optional(),
    relativeRank: z.number().optional(),
  })),
})

// ---------------------------------------------------------------------------
// bandConfusion — 5x5 matrix keyed by expected band then predicted band
// ---------------------------------------------------------------------------

type ConfusionMatrix = Record<EditorialBand, Record<EditorialBand, number>>

function emptyMatrix(): ConfusionMatrix {
  const bands = EDITORIAL_BANDS.map((b) => b.key)
  const matrix = {} as ConfusionMatrix
  for (const expected of bands) {
    matrix[expected] = {} as Record<EditorialBand, number>
    for (const predicted of bands) {
      matrix[expected][predicted] = 0
    }
  }
  return matrix
}

export function bandConfusion(
  output: ProductsReplayOutput,
  expected: ProductsExpected,
): ConfusionMatrix {
  const matrix = emptyMatrix()

  for (const decision of expected.decisions) {
    if (!decision.approvedBand) continue
    const evaluation = output.evaluations[decision.candidateUrl]
    const predictedBand = evaluation ? bandOf(evaluation.score) : null
    if (!predictedBand) continue
    matrix[decision.approvedBand][predictedBand]++
  }

  return matrix
}

// ---------------------------------------------------------------------------
// Pairwise ordering helpers
// ---------------------------------------------------------------------------

/**
 * Computes pairwise concordance rate for expected relativeRank pairs.
 *
 * @param useTieBreak When true, ties in score are broken by searchPosition ASC
 *   (matching production `rankCandidates`). When false, tied scores yield 0.5
 *   per pair (indeterminate).
 */
export function pairwiseConcordance(
  output: ProductsReplayOutput,
  expected: ProductsExpected,
  useTieBreak: boolean,
): number {
  const ranked = expected.decisions.filter((d) => d.relativeRank !== undefined)
  if (ranked.length < 2) return 1

  let concordant = 0
  let total = 0

  for (let i = 0; i < ranked.length; i++) {
    for (let j = i + 1; j < ranked.length; j++) {
      const di = ranked[i]!
      const dj = ranked[j]!
      const evalI = output.evaluations[di.candidateUrl]
      const evalJ = output.evaluations[dj.candidateUrl]

      // Skip pairs where either side has no output evaluation
      if (!evalI || !evalJ) continue
      // Skip pairs where either score is null — avoids coercing null to -1
      if (evalI.score === null || evalJ.score === null) continue

      total++

      // Expected direction: lower relativeRank is better (rank 1 > rank 2)
      const expectedSign = Math.sign(di.relativeRank! - dj.relativeRank!)

      const scoreI = evalI.score ?? -1
      const scoreJ = evalJ.score ?? -1
      const scoreDiff = scoreJ - scoreI // score DESC: higher score = better rank

      if (scoreDiff !== 0) {
        // Scores differ — compare output direction to expected direction
        const outputSign = Math.sign(scoreDiff)
        // score DESC means higher score = lower (better) rank number
        // outputSign > 0 means j has higher score (j ranks better)
        // expectedSign > 0 means i has higher rank number (j ranks better)
        if (outputSign === expectedSign) concordant++
      } else if (useTieBreak) {
        // Tied scores — break by searchPosition ASC
        const posI = evalI.searchPosition ?? Number.MAX_SAFE_INTEGER
        const posJ = evalJ.searchPosition ?? Number.MAX_SAFE_INTEGER
        const posDiff = posI - posJ // position ASC: lower position = better rank
        const outputSign = Math.sign(posDiff)
        if (outputSign === 0 || outputSign === expectedSign) concordant++
      } else {
        // No tie-break — score the indeterminate pair as 0.5
        concordant += 0.5
      }
    }
  }

  return total === 0 ? 1 : concordant / total
}

// ---------------------------------------------------------------------------
// tieBreakAblation
// ---------------------------------------------------------------------------

export type TieBreakAblationResult = {
  withTieBreak: number
  withoutTieBreak: number
}

export function tieBreakAblation(
  output: ProductsReplayOutput,
  expected: ProductsExpected,
): TieBreakAblationResult {
  return {
    withTieBreak: pairwiseConcordance(output, expected, true),
    withoutTieBreak: pairwiseConcordance(output, expected, false),
  }
}

// ---------------------------------------------------------------------------
// windowSweep
// ---------------------------------------------------------------------------

export type WindowSweepEntry = {
  window: number
  selectionAgreement: number
}

/**
 * Recomputes selection agreement for each cutoff window width.
 *
 * For each window value, the simulated selection is:
 *   keep candidates whose score >= (bestScore - window)
 */
export function windowSweep(
  output: ProductsReplayOutput,
  expected: ProductsExpected,
  windows: number[] = [10, 15, 20],
): WindowSweepEntry[] {
  const scores = Object.entries(output.evaluations)
    .filter(([, ev]) => ev.score !== null)
    .map(([url, ev]) => ({ url, score: ev.score! }))

  const bestScore = scores.length > 0 ? Math.max(...scores.map((s) => s.score)) : 0

  const expectedSelectedUrls = new Set(
    expected.decisions.filter((d) => d.selected).map((d) => d.candidateUrl),
  )

  return windows.map((window) => {
    const threshold = bestScore - window
    const simulatedSelected = new Set(
      scores.filter((s) => s.score >= threshold).map((s) => s.url),
    )

    const agreement = jaccard(simulatedSelected, expectedSelectedUrls)
    return { window, selectionAgreement: agreement }
  })
}

// ---------------------------------------------------------------------------
// pairByOfficialUrl
// ---------------------------------------------------------------------------

export type PairResult = {
  paired: Array<{ normalizedUrl: string; a: CuratedProductProposal; b: CuratedProductProposal }>
  onlyA: CuratedProductProposal[]
  onlyB: CuratedProductProposal[]
}

export function pairByOfficialUrl(
  proposalsA: readonly CuratedProductProposal[],
  proposalsB: readonly CuratedProductProposal[],
): PairResult {
  const mapA = new Map<string, CuratedProductProposal>()
  for (const p of proposalsA) {
    const normalized = normalizeProductUrl(p.officialUrl)
    if (normalized) mapA.set(normalized, p)
  }

  const mapB = new Map<string, CuratedProductProposal>()
  for (const p of proposalsB) {
    const normalized = normalizeProductUrl(p.officialUrl)
    if (normalized) mapB.set(normalized, p)
  }

  const paired: PairResult['paired'] = []
  const onlyA: CuratedProductProposal[] = []
  const onlyB: CuratedProductProposal[] = []

  for (const [normalizedUrl, proposalA] of mapA) {
    const proposalB = mapB.get(normalizedUrl)
    if (proposalB) {
      paired.push({ normalizedUrl, a: proposalA, b: proposalB })
    } else {
      onlyA.push(proposalA)
    }
  }

  for (const [normalizedUrl, proposalB] of mapB) {
    if (!mapA.has(normalizedUrl)) {
      onlyB.push(proposalB)
    }
  }

  return { paired, onlyA, onlyB }
}

// ---------------------------------------------------------------------------
// driftRate
// ---------------------------------------------------------------------------

export function driftRate(
  paired: number,
  onlyA: number,
  onlyB: number,
): number {
  const total = paired + onlyA + onlyB
  if (total === 0) return 0
  return (onlyA + onlyB) / total
}

// ---------------------------------------------------------------------------
// summarizeCalibration
// ---------------------------------------------------------------------------

export type CalibrationResults = {
  confusion: ConfusionMatrix
  tieBreak: TieBreakAblationResult
  windowSweep: WindowSweepEntry[]
}

export function summarizeCalibration(results: CalibrationResults): string {
  const lines: string[] = []

  // Confusion matrix
  lines.push('## Band Confusion Matrix')
  lines.push('')
  const bands = EDITORIAL_BANDS.map((b) => b.key)
  lines.push(`| expected \\ predicted | ${bands.join(' | ')} |`)
  lines.push(`| --- | ${bands.map(() => '---').join(' | ')} |`)
  for (const expected of bands) {
    const row = bands.map((predicted) => String(results.confusion[expected][predicted]))
    lines.push(`| ${expected} | ${row.join(' | ')} |`)
  }
  lines.push('')

  // Tie-break ablation
  lines.push('## Tie-Break Ablation')
  lines.push('')
  lines.push(`- With searchPosition tie-break: ${results.tieBreak.withTieBreak.toFixed(3)}`)
  lines.push(`- Without searchPosition tie-break: ${results.tieBreak.withoutTieBreak.toFixed(3)}`)
  lines.push('')

  // Window sweep
  lines.push('## Window Sweep')
  lines.push('')
  lines.push('| Window | Selection Agreement |')
  lines.push('| --- | --- |')
  for (const entry of results.windowSweep) {
    lines.push(`| ${entry.window} | ${entry.selectionAgreement.toFixed(3)} |`)
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Shared Jaccard helper
// ---------------------------------------------------------------------------

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let intersection = 0
  for (const item of a) {
    if (b.has(item)) intersection++
  }
  const union = a.size + b.size - intersection
  return union === 0 ? 1 : intersection / union
}
