import { describe, expect, it } from 'vitest'
import {
  bandConfusion,
  tieBreakAblation,
  windowSweep,
  pairByOfficialUrl,
  driftRate,
  type ProductsReplayOutput,
  type ProductsExpected,
} from '../products-calibration'
import type { CuratedProductProposal } from '@/lib/types/enriched-data'

// ---------------------------------------------------------------------------
// Helpers — minimal proposal factory
// ---------------------------------------------------------------------------

function makeProposal(overrides: Partial<CuratedProductProposal> & { officialUrl: string }): CuratedProductProposal {
  return {
    key: 'k',
    nameZh: '品名',
    category: 'food',
    subcategory: null,
    material: [],
    productDescriptionZh: '描述',
    sources: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// bandConfusion
// ---------------------------------------------------------------------------

describe('bandConfusion', () => {
  it('returns a 5x5 matrix keyed by expected then predicted band', () => {
    const output: ProductsReplayOutput = {
      evaluations: {
        'https://a.com/1': { score: 92, searchPosition: 1 }, // exceptional
        'https://a.com/2': { score: 50, searchPosition: 2 }, // generic
        'https://a.com/3': { score: 65, searchPosition: 3 }, // representative
        'https://a.com/4': { score: 10, searchPosition: 4 }, // ineligible
      },
      selected: [],
      proposals: [],
      agentOutcome: 'ok',
    }
    const expected: ProductsExpected = {
      decisions: [
        { candidateUrl: 'https://a.com/1', selected: true, approvedBand: 'exceptional' },
        { candidateUrl: 'https://a.com/2', selected: false, approvedBand: 'strong' },     // mismatch: expected strong, got generic
        { candidateUrl: 'https://a.com/3', selected: true, approvedBand: 'representative' },
        { candidateUrl: 'https://a.com/4', selected: false, approvedBand: 'ineligible' },
      ],
    }

    const matrix = bandConfusion(output, expected)

    // Verify all 5 expected bands exist as keys
    expect(Object.keys(matrix)).toHaveLength(5)
    expect(matrix.exceptional.exceptional).toBe(1)
    expect(matrix.strong.generic).toBe(1)        // mismatch cell
    expect(matrix.representative.representative).toBe(1)
    expect(matrix.ineligible.ineligible).toBe(1)

    // Verify zero cells
    expect(matrix.exceptional.generic).toBe(0)
    expect(matrix.generic.generic).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// tieBreakAblation
// ---------------------------------------------------------------------------

describe('tieBreakAblation', () => {
  it('reports ordering agreement with and without searchPosition', () => {
    // Two candidates with the SAME score — tie-break matters
    // Expected: p1 rank 1, p2 rank 2
    // Scores are equal (80), but searchPosition: p1=1, p2=5
    // With tie-break: p1 comes first (searchPosition 1 < 5) => concordant => 1.0
    // Without tie-break: tied scores => 0.5
    const output: ProductsReplayOutput = {
      evaluations: {
        'https://a.com/p1': { score: 80, searchPosition: 1 },
        'https://a.com/p2': { score: 80, searchPosition: 5 },
      },
      selected: [],
      proposals: [],
      agentOutcome: 'ok',
    }
    const expected: ProductsExpected = {
      decisions: [
        { candidateUrl: 'https://a.com/p1', selected: true, relativeRank: 1 },
        { candidateUrl: 'https://a.com/p2', selected: true, relativeRank: 2 },
      ],
    }

    const result = tieBreakAblation(output, expected)
    expect(result.withTieBreak).toBe(1)
    expect(result.withoutTieBreak).toBe(0.5)
  })

  it('returns equal values when no scores are tied', () => {
    const output: ProductsReplayOutput = {
      evaluations: {
        'https://a.com/p1': { score: 90, searchPosition: 1 },
        'https://a.com/p2': { score: 70, searchPosition: 2 },
      },
      selected: [],
      proposals: [],
      agentOutcome: 'ok',
    }
    const expected: ProductsExpected = {
      decisions: [
        { candidateUrl: 'https://a.com/p1', selected: true, relativeRank: 1 },
        { candidateUrl: 'https://a.com/p2', selected: true, relativeRank: 2 },
      ],
    }

    const result = tieBreakAblation(output, expected)
    expect(result.withTieBreak).toBe(result.withoutTieBreak)
  })
})

// ---------------------------------------------------------------------------
// windowSweep
// ---------------------------------------------------------------------------

describe('windowSweep', () => {
  it('recomputes selectionAgreement for windows 10/15/20 from output scores', () => {
    // bestScore = 95. Window 10 => keep >= 85 (p1 only)
    // Window 15 => keep >= 80 (p1, p2)
    // Window 20 => keep >= 75 (p1, p2, p3)
    const output: ProductsReplayOutput = {
      evaluations: {
        'https://a.com/p1': { score: 95, searchPosition: 1 },
        'https://a.com/p2': { score: 85, searchPosition: 2 },
        'https://a.com/p3': { score: 78, searchPosition: 3 },
        'https://a.com/p4': { score: 50, searchPosition: 4 },
      },
      selected: [],
      proposals: [],
      agentOutcome: 'ok',
    }
    const expected: ProductsExpected = {
      decisions: [
        { candidateUrl: 'https://a.com/p1', selected: true },
        { candidateUrl: 'https://a.com/p2', selected: true },
        { candidateUrl: 'https://a.com/p3', selected: true },
        { candidateUrl: 'https://a.com/p4', selected: false },
      ],
    }

    const result = windowSweep(output, expected, [10, 15, 20])

    // Window 10: selected={p1}, expected={p1,p2,p3} => Jaccard=1/3
    // Window 15: selected={p1,p2}, expected={p1,p2,p3} => Jaccard=2/3
    // Window 20: selected={p1,p2,p3}, expected={p1,p2,p3} => Jaccard=3/3
    expect(result).toHaveLength(3)
    expect(result[0]!.window).toBe(10)
    expect(result[1]!.window).toBe(15)
    expect(result[2]!.window).toBe(20)

    // Window 20 agreement >= window 10 agreement (wider window includes more)
    expect(result[2]!.selectionAgreement).toBeGreaterThanOrEqual(result[0]!.selectionAgreement)
  })
})

// ---------------------------------------------------------------------------
// pairByOfficialUrl
// ---------------------------------------------------------------------------

describe('pairByOfficialUrl', () => {
  it('pairs proposals by normalizeProductUrl and reports onlyA/onlyB', () => {
    // Same URL with different tracking params should pair
    const proposalsA = [
      makeProposal({ officialUrl: 'https://brand.com/product-1?utm_source=google' }),
      makeProposal({ officialUrl: 'https://brand.com/product-2' }),
    ]
    const proposalsB = [
      makeProposal({ officialUrl: 'https://brand.com/product-1?fbclid=abc' }),
      makeProposal({ officialUrl: 'https://brand.com/product-3' }),
    ]

    const result = pairByOfficialUrl(proposalsA, proposalsB)

    // product-1 normalizes to the same URL in both => paired
    expect(result.paired).toHaveLength(1)
    expect(result.paired[0]!.a.officialUrl).toBe('https://brand.com/product-1?utm_source=google')
    expect(result.paired[0]!.b.officialUrl).toBe('https://brand.com/product-1?fbclid=abc')

    // product-2 only in A, product-3 only in B
    expect(result.onlyA).toHaveLength(1)
    expect(result.onlyB).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// driftRate
// ---------------------------------------------------------------------------

describe('driftRate', () => {
  it('computes (onlyA+onlyB)/(paired+onlyA+onlyB)', () => {
    // 3 paired, 1 onlyA, 2 onlyB => (1+2)/(3+1+2) = 3/6 = 0.5
    expect(driftRate(3, 1, 2)).toBe(0.5)
  })

  it('returns 0 when nothing proposed', () => {
    expect(driftRate(0, 0, 0)).toBe(0)
  })

  it('returns 1 when nothing is paired', () => {
    expect(driftRate(0, 2, 3)).toBe(1)
  })
})
