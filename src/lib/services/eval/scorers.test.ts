import {
  languagePurity,
  lengthBand,
  classificationPrecision,
  decisionAgreement,
  confidenceBandAgreement,
  categoryAgreement,
  writeEligibleAgreement,
  schemaCompliance,
  bannedTermScore,
  bandAgreement,
  withinPoolOrderingAgreement,
  selectionAgreement,
  originWhenSourced,
  precisionAtK,
  recallAtK,
  mrr,
  mean,
  p95,
  ndcgAtK,
  bootstrapCI,
  pairedBootstrapCI,
  ndcgAt,
  expectedCalibrationError,
  acceptedAccuracyAt,
  coverageAt,
  thresholdSweep,
  bandFromProbability,
  JEV_BAND_CUTOFFS,
  planFetchCapOk,
  planSchemaValid,
  recoveryActionConsistent,
  verdictAgreement,
  type GradedItem,
} from './scorers'
import { expect, it, describe } from 'vitest'
import { z } from 'zod'
import type { ProductsReplayOutput, ProductsExpected } from './products-calibration'

it('languagePurity flags English runs inside a zh field and vice versa', () => {
  expect(languagePurity('這是一段完整的繁體中文品牌描述內容', 'zh')).toBe(1)
  expect(languagePurity('這個品牌 offers great quality products 給大家', 'zh')).toBeLessThan(0.8)
  expect(languagePurity('A fully English description of the brand.', 'en')).toBe(1)
})
it('lengthBand checks inclusive char bands', () => {
  expect(lengthBand('a'.repeat(400), [300, 600])).toBe(true)
  expect(lengthBand('short', [300, 600])).toBe(false)
})
it('classificationPrecision compares predicted vs labeled image tags', () => {
  const labeled = [{ url: 'u1', junk: true }, { url: 'u2', junk: false }]
  // `promo` is a LEGACY tag: only pre-contract rows carry it, and it must still
  // score as junk so historic corpora keep grading correctly.
  const predicted = new Map([['u1', 'promo'], ['u2', 'product']])
  expect(classificationPrecision(labeled, predicted)).toBe(1)
})

it('treats both current keep tags as publishable rather than junk', () => {
  expect(
    classificationPrecision(
      [
        { url: 'i1', junk: false },
        { url: 'i2', junk: false },
      ],
      new Map([
        ['i1', 'logo'],
        ['i2', 'product'],
      ]),
    ),
  ).toBe(1)
})

it('cannot see a rejection that carries no tag — callers must supply one', () => {
  // Documented limitation, not desired behaviour. Under the disposition/reasons
  // contract a rejected image has `tags: null`, and an absent prediction reads
  // as "not junk" here. Callers scoring modern rows must map disposition to a
  // tag before calling; a disposition-aware harness scores them directly.
  expect(
    classificationPrecision([{ url: 'i1', junk: true }], new Map()),
  ).toBe(0)
})

it('decisionAgreement returns 1 on equal decisions and 0 otherwise', () => {
  expect(decisionAgreement('approve', 'approve')).toBe(1)
  expect(decisionAgreement(true, true)).toBe(1)
  expect(decisionAgreement('approve', 'reject')).toBe(0)
  expect(decisionAgreement(undefined, 'approve')).toBe(0)
})

it('confidenceBandAgreement is exact on high/medium/low', () => {
  expect(confidenceBandAgreement('high', 'high')).toBe(1)
  expect(confidenceBandAgreement('medium', 'medium')).toBe(1)
  expect(confidenceBandAgreement('low', 'low')).toBe(1)
  expect(confidenceBandAgreement('high', 'low')).toBe(0)
  expect(confidenceBandAgreement('unknown', 'high')).toBe(0)
  expect(confidenceBandAgreement(undefined, 'high')).toBe(0)
})

it('categoryAgreement gives 1.0, 0.5, 0', () => {
  expect(categoryAgreement(
    { category: 'food', subcategory: 'tea' },
    { category: 'food', subcategory: 'tea' },
  )).toBe(1)
  expect(categoryAgreement(
    { category: 'food', subcategory: null },
    { category: 'food', subcategory: null },
  )).toBe(1)
  expect(categoryAgreement(
    { category: 'food', subcategory: 'tea' },
    { category: 'food', subcategory: 'coffee' },
  )).toBe(0.5)
  expect(categoryAgreement(
    { category: 'food', subcategory: 'tea' },
    { category: 'beauty', subcategory: 'skincare' },
  )).toBe(0)
})

it('writeEligibleAgreement compares derived eligibility', () => {
  const alwaysTrue = () => true
  const alwaysFalse = () => false
  expect(writeEligibleAgreement({ links: 3 }, { writeEligible: true }, alwaysTrue)).toBe(1)
  expect(writeEligibleAgreement({ links: 0 }, { writeEligible: true }, alwaysFalse)).toBe(0)
  expect(writeEligibleAgreement({ links: 0 }, { writeEligible: false }, alwaysFalse)).toBe(1)
})

it('schemaCompliance returns 1 for a parse success and 0 for failure', () => {
  const schema = z.object({ name: z.string(), count: z.number() })
  expect(schemaCompliance({ name: 'x', count: 1 }, schema)).toBe(1)
  expect(schemaCompliance({ name: 'x' }, schema)).toBe(0)
  expect(schemaCompliance(null, schema)).toBe(0)
})

it('bannedTermScore returns 1 with no hits and 0 with any hit', () => {
  expect(bannedTermScore({ description: '這是正常的台灣中文' })).toBe(1)
  // 視頻 is a known banned term (mainland Chinese for 影片)
  expect(bannedTermScore({ description: '這個視頻很好看' })).toBe(0)
})

// ---------------------------------------------------------------------------
// Product ranking scorers (DEV-1695)
// ---------------------------------------------------------------------------

describe('bandAgreement', () => {
  it('scores 1 when every expected candidate bandOf(score) matches approvedBand', () => {
    const output: ProductsReplayOutput = {
      evaluations: {
        'https://a.com/p1': { score: 92, searchPosition: 1 },
        'https://a.com/p2': { score: 50, searchPosition: 2 },
      },
      selected: [],
      proposals: [],
      agentOutcome: 'ok',
    }
    const expected: ProductsExpected = {
      decisions: [
        { candidateUrl: 'https://a.com/p1', selected: true, approvedBand: 'exceptional' },
        { candidateUrl: 'https://a.com/p2', selected: false, approvedBand: 'generic' },
      ],
    }
    expect(bandAgreement(output, expected)).toBe(1)
  })

  it('scores 0.5 when one of two decisions matches', () => {
    const output: ProductsReplayOutput = {
      evaluations: {
        'https://a.com/p1': { score: 92, searchPosition: 1 },
        'https://a.com/p2': { score: 50, searchPosition: 2 },
      },
      selected: [],
      proposals: [],
      agentOutcome: 'ok',
    }
    const expected: ProductsExpected = {
      decisions: [
        { candidateUrl: 'https://a.com/p1', selected: true, approvedBand: 'exceptional' },
        { candidateUrl: 'https://a.com/p2', selected: false, approvedBand: 'strong' },
      ],
    }
    expect(bandAgreement(output, expected)).toBe(0.5)
  })

  it('scores 0 on missing score', () => {
    const output: ProductsReplayOutput = {
      evaluations: {},
      selected: [],
      proposals: [],
      agentOutcome: 'ok',
    }
    const expected: ProductsExpected = {
      decisions: [
        { candidateUrl: 'https://a.com/p1', selected: true, approvedBand: 'exceptional' },
      ],
    }
    expect(bandAgreement(output, expected)).toBe(0)
  })
})

describe('withinPoolOrderingAgreement', () => {
  it('returns 1.0 for matching order', () => {
    // Expected: p1 rank 1, p2 rank 2, p3 rank 3
    // Output scores: p1=90 > p2=70 > p3=50 => same order
    const output: ProductsReplayOutput = {
      evaluations: {
        'https://a.com/p1': { score: 90, searchPosition: 1 },
        'https://a.com/p2': { score: 70, searchPosition: 2 },
        'https://a.com/p3': { score: 50, searchPosition: 3 },
      },
      selected: [],
      proposals: [],
      agentOutcome: 'ok',
    }
    const expected: ProductsExpected = {
      decisions: [
        { candidateUrl: 'https://a.com/p1', selected: true, relativeRank: 1 },
        { candidateUrl: 'https://a.com/p2', selected: true, relativeRank: 2 },
        { candidateUrl: 'https://a.com/p3', selected: false, relativeRank: 3 },
      ],
    }
    expect(withinPoolOrderingAgreement(output, expected)).toBe(1)
  })

  it('returns 0 for fully reversed order', () => {
    // Expected: p1 rank 1, p2 rank 2, p3 rank 3
    // Output scores: p1=30 < p2=60 < p3=90 => fully reversed
    const output: ProductsReplayOutput = {
      evaluations: {
        'https://a.com/p1': { score: 30, searchPosition: 1 },
        'https://a.com/p2': { score: 60, searchPosition: 2 },
        'https://a.com/p3': { score: 90, searchPosition: 3 },
      },
      selected: [],
      proposals: [],
      agentOutcome: 'ok',
    }
    const expected: ProductsExpected = {
      decisions: [
        { candidateUrl: 'https://a.com/p1', selected: true, relativeRank: 1 },
        { candidateUrl: 'https://a.com/p2', selected: true, relativeRank: 2 },
        { candidateUrl: 'https://a.com/p3', selected: false, relativeRank: 3 },
      ],
    }
    expect(withinPoolOrderingAgreement(output, expected)).toBe(0)
  })

  it('resolves tied scores by searchPosition', () => {
    // Expected: p1 rank 1, p2 rank 2
    // Output scores: both 80, but p1 searchPosition 1 < p2 searchPosition 5
    // => output order p1 before p2 => concordant
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
    expect(withinPoolOrderingAgreement(output, expected)).toBe(1)
  })
})

describe('selectionAgreement', () => {
  it('returns 1.0 for perfect overlap', () => {
    const output: ProductsReplayOutput = {
      evaluations: {},
      selected: ['https://a.com/p1', 'https://a.com/p2'],
      proposals: [],
      agentOutcome: 'ok',
    }
    const expected: ProductsExpected = {
      decisions: [
        { candidateUrl: 'https://a.com/p1', selected: true },
        { candidateUrl: 'https://a.com/p2', selected: true },
      ],
    }
    expect(selectionAgreement(output, expected)).toBe(1)
  })

  it('returns 0.5 for partial overlap', () => {
    // Output: {p1, p2}, Expected: {p1, p3}
    // Intersection: {p1} size 1, Union: {p1,p2,p3} size 3 => 1/3
    // Actually Jaccard = 1/3, not 0.5. Let me make a 0.5 case:
    // Output: {p1, p2}, Expected: {p1} => Intersection=1, Union=2 => 0.5
    const output: ProductsReplayOutput = {
      evaluations: {},
      selected: ['https://a.com/p1', 'https://a.com/p2'],
      proposals: [],
      agentOutcome: 'ok',
    }
    const expected: ProductsExpected = {
      decisions: [
        { candidateUrl: 'https://a.com/p1', selected: true },
        { candidateUrl: 'https://a.com/p2', selected: false },
      ],
    }
    // Output selected: {p1, p2}, Expected selected: {p1}
    // Intersection: {p1}=1, Union: {p1,p2}=2 => 0.5
    expect(selectionAgreement(output, expected)).toBe(0.5)
  })

  it('returns 0 for no overlap', () => {
    const output: ProductsReplayOutput = {
      evaluations: {},
      selected: ['https://a.com/p1'],
      proposals: [],
      agentOutcome: 'ok',
    }
    const expected: ProductsExpected = {
      decisions: [
        { candidateUrl: 'https://a.com/p1', selected: false },
        { candidateUrl: 'https://a.com/p2', selected: true },
      ],
    }
    // Output selected: {p1}, Expected selected: {p2}
    // Intersection: 0, Union: {p1,p2}=2 => 0
    expect(selectionAgreement(output, expected)).toBe(0)
  })

  it('returns 1.0 for both empty', () => {
    const output: ProductsReplayOutput = {
      evaluations: {},
      selected: [],
      proposals: [],
      agentOutcome: 'ok',
    }
    const expected: ProductsExpected = {
      decisions: [
        { candidateUrl: 'https://a.com/p1', selected: false },
      ],
    }
    expect(selectionAgreement(output, expected)).toBe(1)
  })
})

describe('originWhenSourced', () => {
  const proposal = (officialUrl: string, productDescriptionZh: string) =>
    ({ officialUrl, productDescriptionZh }) as ProductsReplayOutput['proposals'][number]

  it('scores the share of origin-stated proposals whose description mentions Taiwan', () => {
    const output: ProductsReplayOutput = {
      evaluations: {},
      selected: [],
      proposals: [
        proposal('https://a.com/p1', '在台灣製作的木湯匙。'),
        proposal('https://a.com/p2', '手工木湯匙。'),
      ],
      agentOutcome: 'ok',
      originStatedUrls: ['https://a.com/p1', 'https://a.com/p2'],
    }
    expect(originWhenSourced(output)).toBe(0.5)
  })

  it('is n/a (null, not 1) when originStatedUrls is undefined or empty', () => {
    const base: ProductsReplayOutput = {
      evaluations: {},
      selected: [],
      proposals: [proposal('https://a.com/p1', '手工木湯匙。')],
      agentOutcome: 'ok',
    }
    expect(originWhenSourced(base)).toBeNull()
    expect(originWhenSourced({ ...base, originStatedUrls: [] })).toBeNull()
  })

  it('ignores proposals on pages without stated origin', () => {
    const output: ProductsReplayOutput = {
      evaluations: {},
      selected: [],
      proposals: [
        proposal('https://a.com/p1', '臺灣製造的陶杯。'),
        proposal('https://a.com/p2', '手工陶杯。'),
      ],
      agentOutcome: 'ok',
      originStatedUrls: ['https://a.com/p1'],
    }
    expect(originWhenSourced(output)).toBe(1)
    expect(
      originWhenSourced({ ...output, originStatedUrls: ['https://a.com/other'] }),
    ).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// IR scorers (migrated from metrics.ts + new)
// ---------------------------------------------------------------------------

describe('precisionAtK', () => {
  it('matches legacy — fraction of top-k that are relevant', () => {
    expect(precisionAtK(['a', 'b', 'c', 'd'], ['a', 'c'], 3)).toBeCloseTo(2 / 3)
  })

  it('returns 0 when k is 0', () => {
    expect(precisionAtK(['a'], ['a'], 0)).toBe(0)
  })
})

describe('recallAtK', () => {
  it('matches legacy — fraction of expected found in top-k', () => {
    expect(recallAtK(['a', 'x', 'c', 'b'], ['a', 'b', 'c'], 3)).toBeCloseTo(2 / 3)
  })

  it('returns 0 when expected is empty', () => {
    expect(recallAtK(['a', 'b'], [], 2)).toBe(0)
  })
})

describe('mrr', () => {
  it('matches legacy — reciprocal rank of first hit', () => {
    expect(mrr(['x', 'b', 'a'], ['a', 'b'])).toBeCloseTo(0.5)
  })

  it('returns 0 when no expected item is found', () => {
    expect(mrr(['x', 'y', 'z'], ['a', 'b'])).toBe(0)
  })
})

describe('p95 and mean migrated', () => {
  it('p95 matches legacy value', () => {
    expect(p95([1, 2, 3, 4, 100])).toBe(100)
  })

  it('mean matches legacy value', () => {
    expect(mean([1, 2, 3])).toBe(2)
  })
})

describe('ndcgAtK', () => {
  it('returns 1.0 for perfect ranking', () => {
    const expected: GradedItem[] = [
      { key: 'a', grade: 3 },
      { key: 'b', grade: 2 },
      { key: 'c', grade: 1 },
    ]
    // Perfect order: a, b, c
    expect(ndcgAtK(['a', 'b', 'c'], expected, 3)).toBeCloseTo(1.0)
  })

  it('returns 0 for completely irrelevant', () => {
    const expected: GradedItem[] = [
      { key: 'a', grade: 3 },
      { key: 'b', grade: 2 },
    ]
    // No graded item in top-3
    expect(ndcgAtK(['x', 'y', 'z'], expected, 3)).toBe(0)
  })

  it('handles partial matches', () => {
    const expected: GradedItem[] = [
      { key: 'a', grade: 3 },
      { key: 'b', grade: 2 },
      { key: 'c', grade: 1 },
    ]
    // Only 'b' appears at position 1 (rank 1)
    // DCG = 2 / log2(2) = 2
    // IDCG = 3/log2(2) + 2/log2(3) + 1/log2(4) = 3 + 1.2618.. + 0.5 = 4.7618..
    const result = ndcgAtK(['b', 'x', 'y'], expected, 3)
    expect(result).toBeGreaterThan(0)
    expect(result).toBeLessThan(1)
    // DCG/IDCG = 2 / 4.7618.. ≈ 0.4200
    expect(result).toBeCloseTo(2 / (3 / Math.log2(2) + 2 / Math.log2(3) + 1 / Math.log2(4)))
  })
})

describe('bootstrapCI', () => {
  it('contains true mean', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const ci = bootstrapCI(values, 2000, 0.05)
    expect(ci.lo).toBeLessThanOrEqual(ci.mean)
    expect(ci.hi).toBeGreaterThanOrEqual(ci.mean)
    expect(ci.mean).toBeCloseTo(5.5)
  })

  it('narrows with more data', () => {
    const small = [1, 2, 3, 4, 5]
    const large = Array.from({ length: 100 }, (_, i) => (i % 5) + 1)
    const ciSmall = bootstrapCI(small, 2000, 0.05)
    const ciLarge = bootstrapCI(large, 2000, 0.05)
    const widthSmall = ciSmall.hi - ciSmall.lo
    const widthLarge = ciLarge.hi - ciLarge.lo
    expect(widthSmall).toBeGreaterThan(widthLarge)
  })
})

describe('ndcgAt curried factory', () => {
  it('ndcgAt(k)(output, expected) === ndcgAtK(output, expected, k)', () => {
    const expected: GradedItem[] = [
      { key: 'a', grade: 3 },
      { key: 'b', grade: 2 },
      { key: 'c', grade: 1 },
    ]
    const retrieved = ['b', 'a', 'c']
    expect(ndcgAt(10)(retrieved, expected)).toBe(ndcgAtK(retrieved, expected, 10))
  })
})

describe('bootstrapCI seeded', () => {
  it('is reproducible with a seed', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const ci1 = bootstrapCI(values, 1000, 0.05, { seed: 7 })
    const ci2 = bootstrapCI(values, 1000, 0.05, { seed: 7 })
    expect(ci1).toEqual(ci2)
    // unseeded still works
    const ci3 = bootstrapCI(values, 1000, 0.05)
    expect(ci3.lo).toBeLessThanOrEqual(ci3.mean)
    expect(ci3.hi).toBeGreaterThanOrEqual(ci3.mean)
  })
})

describe('pairedBootstrapCI', () => {
  it('returns the CI of per-query differences', () => {
    const a = [0.5, 0.6, 0.7]
    const b = [0.4, 0.5, 0.6]
    const ci = pairedBootstrapCI(a, b, { seed: 42 })
    expect(ci.mean).toBeCloseTo(0.1, 9)
    expect(ci.lo).toBeGreaterThan(0)
  })

  it('throws on length mismatch', () => {
    expect(() => pairedBootstrapCI([1], [1, 2])).toThrow()
  })

  it('reports a sign-test p-value', () => {
    // All zero differences → p = 1
    const ci1 = pairedBootstrapCI([1, 2, 3], [1, 2, 3], { seed: 1 })
    expect(ci1.signTestP).toBe(1)

    // 20 positive differences → p < 0.05
    const ones = Array.from({ length: 20 }, () => 1)
    const zeros = Array.from({ length: 20 }, () => 0)
    const ci2 = pairedBootstrapCI(ones, zeros, { seed: 1 })
    expect(ci2.signTestP).toBeLessThan(0.05)
  })
})

describe('calibration scorers', () => {
  // Hand-computed: bin 9 {0.95 ok, 0.95 miss} -> acc 0.5, conf 0.95, gap 0.45, n 2
  //                bin 2 {0.25 miss}          -> acc 0,   conf 0.25, gap 0.25, n 1
  //                bin 6 {0.65 ok}            -> acc 1,   conf 0.65, gap 0.35, n 1
  // ECE = 2/4*0.45 + 1/4*0.25 + 1/4*0.35 = 0.375
  const fixture = [
    { p: 0.95, correct: true },
    { p: 0.95, correct: false },
    { p: 0.25, correct: false },
    { p: 0.65, correct: true },
  ]

  it('expectedCalibrationError on a hand-computed fixture', () => {
    expect(Math.abs((expectedCalibrationError(fixture) as number) - 0.375)).toBeLessThan(1e-9)
    expect(expectedCalibrationError([])).toBeNull()
  })

  it('acceptedAccuracyAt(threshold)', () => {
    // p >= 0.6: {0.95 ok, 0.95 miss, 0.65 ok} -> 2/3
    expect(acceptedAccuracyAt(fixture, 0.6)).toBeCloseTo(2 / 3, 9)
    // boundary is inclusive
    expect(acceptedAccuracyAt(fixture, 0.65)).toBeCloseTo(2 / 3, 9)
    expect(acceptedAccuracyAt(fixture, 0.99)).toBeNull()
  })

  it('coverageAt(threshold)', () => {
    expect(coverageAt(fixture, 0.6)).toBe(0.75)
    expect(coverageAt(fixture, 0.95)).toBe(0.5)
    expect(coverageAt(fixture, 0.99)).toBe(0)
  })

  it('thresholdSweep renders a markdown table for 0.50..0.95 step 0.05', () => {
    const lines = thresholdSweep(fixture).trim().split('\n')
    expect(lines[0]).toBe('| threshold | coverage | accepted accuracy |')
    expect(lines[1]).toMatch(/^\|[-\s|]+\|$/)
    const rows = lines.slice(2)
    expect(rows).toHaveLength(10)
    expect(rows[0]).toMatch(/^\| 0\.50 \|/)
    expect(rows[9]).toMatch(/^\| 0\.95 \|/)
    // 0.95 threshold must include p = 0.95 exactly (no float drift)
    expect(rows[9]).toContain('| 0.500 |')
  })

  it('bandFromProbability uses JEV_BAND_CUTOFFS', () => {
    expect(JEV_BAND_CUTOFFS).toEqual({ high: 0.9, medium: 0.7 })
    expect(bandFromProbability(0.95)).toBe('high')
    expect(bandFromProbability(0.8)).toBe('medium')
    expect(bandFromProbability(0.5)).toBe('low')
  })
})

// ---------------------------------------------------------------------------
// DEV-1873 golden-set scorers
// ---------------------------------------------------------------------------

function planWith(fetches: number, fanOut = 0) {
  const surfaces = Array.from({ length: fetches - fanOut }, (_, i) => ({
    url: `https://brand.example/p${i}`,
    fetch: 'static' as const,
    reason: 'product page',
  }))
  return {
    surfaces: [
      ...surfaces,
      { url: 'https://brand.example/skipped', fetch: 'skip' as const, reason: 'not the brand' },
    ],
    fanOut: Array.from({ length: fanOut }, (_, i) => `https://brand.example/f${i}`),
    catalog: { entryUrls: [], priorityProductUrls: [] },
    socialBios: {},
    decisions: [],
  }
}

describe('planFetchCapOk', () => {
  it('is 1 for 6 fetches and 0 for 7, counting non-skip surfaces plus fanOut', () => {
    expect(planFetchCapOk(planWith(6))).toBe(1)
    expect(planFetchCapOk(planWith(6, 2))).toBe(1)
    expect(planFetchCapOk(planWith(7))).toBe(0)
    expect(planFetchCapOk(planWith(7, 3))).toBe(0)
  })

  it('is 0 for a null plan', () => {
    expect(planFetchCapOk(null)).toBe(0)
  })

  it('is 0, not a throw, when surfaces or fanOut is not an array', () => {
    expect(planFetchCapOk({ surfaces: 'nope', fanOut: [] })).toBe(0)
    expect(planFetchCapOk({ surfaces: [], fanOut: { url: 'x' } })).toBe(0)
    expect(planFetchCapOk({ surfaces: [null], fanOut: [] })).toBe(1)
  })
})

describe('planSchemaValid', () => {
  it('is 1 for a valid plan', () => {
    expect(planSchemaValid(planWith(3))).toBe(1)
  })

  it('is 0 for a plan that fails AcquisitionPlan.safeParse (including the refine)', () => {
    expect(planSchemaValid({ surfaces: [] })).toBe(0)
    expect(planSchemaValid(planWith(7))).toBe(0)
  })

  it('is 0 for a null plan', () => {
    expect(planSchemaValid(null)).toBe(0)
  })
})

describe('recoveryActionConsistent', () => {
  it('is 1 when recoveryAction is non-null exactly when the verdict is thin', () => {
    expect(recoveryActionConsistent({ verdict: 'thin', recoveryAction: 'fanout' })).toBe(1)
    expect(recoveryActionConsistent({ verdict: 'sufficient', recoveryAction: null })).toBe(1)
    expect(recoveryActionConsistent({ verdict: 'fail', recoveryAction: null })).toBe(1)
  })

  it('is 0 otherwise', () => {
    expect(recoveryActionConsistent({ verdict: 'thin', recoveryAction: null })).toBe(0)
    expect(recoveryActionConsistent({ verdict: 'sufficient', recoveryAction: 'search' })).toBe(0)
    expect(recoveryActionConsistent({ verdict: 'fail', recoveryAction: 'render' })).toBe(0)
  })
})

describe('verdictAgreement', () => {
  it('reuses decisionAgreement on verdict', () => {
    expect(verdictAgreement({ verdict: 'thin' }, { verdict: 'thin' })).toBe(1)
    expect(verdictAgreement({ verdict: 'thin' }, { verdict: 'fail' })).toBe(0)
    expect(verdictAgreement({}, { verdict: 'fail' })).toBe(0)
  })
})
