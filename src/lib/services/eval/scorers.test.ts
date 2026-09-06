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
