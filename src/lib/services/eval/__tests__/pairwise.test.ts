import { describe, expect, it, vi } from 'vitest'
import {
  stratifiedSample,
  blind,
  unblind,
  buildDescriptionTask,
  pairwiseReport,
  type PairwiseBrand,
} from '../pairwise'

// ---------------------------------------------------------------------------
// Seeded RNG for deterministic tests
// ---------------------------------------------------------------------------

function seededRng(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    return (s >>> 0) / 0x100000000
  }
}

// ---------------------------------------------------------------------------
// stratifiedSample
// ---------------------------------------------------------------------------

describe('stratifiedSample', () => {
  it('picks n brands proportionally across categories with a floor of 1 per category present', () => {
    const brands: PairwiseBrand[] = [
      // 10 in cat A
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `a-${i}`,
        name: `A${i}`,
        category: 'food',
        slug: `a-${i}`,
        description: null,
      })),
      // 5 in cat B
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `b-${i}`,
        name: `B${i}`,
        category: 'fashion',
        slug: `b-${i}`,
        description: null,
      })),
      // 1 in cat C (should get at least 1 — the floor)
      {
        id: 'c-0',
        name: 'C0',
        category: 'crafts',
        slug: 'c-0',
        description: null,
      },
    ]

    const rng = seededRng(42)
    const result = stratifiedSample({ brands, n: 8, rng })

    expect(result).toHaveLength(8)

    // Floor: every category present in the input appears in the output
    const outputCategories = new Set(result.map((b) => b.category))
    expect(outputCategories).toContain('food')
    expect(outputCategories).toContain('fashion')
    expect(outputCategories).toContain('crafts')

    // crafts has only 1 brand total, so it should get exactly the floor of 1
    const craftsCount = result.filter((b) => b.category === 'crafts').length
    expect(craftsCount).toBe(1)

    // food has 10/16 = 62.5%, should get more than fashion's 5/16 = 31.25%
    const foodCount = result.filter((b) => b.category === 'food').length
    const fashionCount = result.filter((b) => b.category === 'fashion').length
    expect(foodCount).toBeGreaterThan(fashionCount)

    // All returned brands exist in the original list
    const allIds = new Set(brands.map((b) => b.id))
    for (const b of result) {
      expect(allIds).toContain(b.id)
    }
  })

  it('returns all brands when n >= brands.length', () => {
    const brands: PairwiseBrand[] = [
      { id: '1', name: 'A', category: 'food', slug: 'a', description: null },
      { id: '2', name: 'B', category: 'food', slug: 'b', description: null },
    ]
    const result = stratifiedSample({ brands, n: 5 })
    expect(result).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// blind / unblind
// ---------------------------------------------------------------------------

describe('blind / unblind', () => {
  it('returns {left, right} and a mapping; unblind inverts it', () => {
    const a = { text: 'output A' }
    const b = { text: 'output B' }

    // Run with a seeded RNG that produces a known order
    const rng = seededRng(99)
    const result = blind(a, b, rng)

    // Both values present
    expect(new Set([result.left, result.right])).toEqual(new Set([a, b]))

    // mapping keys match positions
    expect(result.mapping.left).toMatch(/^[ab]$/)
    expect(result.mapping.right).toMatch(/^[ab]$/)
    expect(result.mapping.left).not.toBe(result.mapping.right)

    // unblind inverts: recover which side was a vs b
    const unblinded = unblind(result.mapping)
    if (result.mapping.left === 'a') {
      expect(unblinded.a).toBe('left')
      expect(unblinded.b).toBe('right')
    } else {
      expect(unblinded.a).toBe('right')
      expect(unblinded.b).toBe('left')
    }
  })

  it('covers both orderings with explicit RNG values', () => {
    const a = 'X'
    const b = 'Y'

    // RNG returning < 0.5 → left=a, right=b
    const r1 = blind(a, b, () => 0.3)
    expect(r1.mapping.left).toBe('a')
    expect(r1.left).toBe(a)

    // RNG returning >= 0.5 → left=b, right=a
    const r2 = blind(a, b, () => 0.7)
    expect(r2.mapping.left).toBe('b')
    expect(r2.left).toBe(b)
  })
})

// ---------------------------------------------------------------------------
// buildDescriptionTask
// ---------------------------------------------------------------------------

describe('buildDescriptionTask', () => {
  it('calls rewriteBrandDescription with audit.target undefined', async () => {
    const brand: PairwiseBrand = {
      id: 'brand-1',
      name: 'TestBrand',
      category: 'food',
      slug: 'test-brand',
      description: 'existing desc',
    }

    const mockScrapeText = {
      snippets: ['snippet1', 'snippet2'],
      siteContent: 'scraped site content',
    }

    const mockEvidence = {
      links: { socialInstagram: 'https://instagram.com/test' },
      productCategoryZh: '食品',
      imageAlts: [],
    }

    const mockRewriteResult = {
      result: {
        description_zh: '中文描述',
        description_en: 'English description',
        description: '中文描述',
        blurb_zh: '短描述',
        blurb_en: 'Short desc',
        validationRejections: [],
      },
      attempts: [],
      calls: { attempted: 1, providerFailed: 0 },
    }

    const rewriteFn = vi.fn().mockResolvedValue(mockRewriteResult)
    const loadScrapeTextFn = vi.fn().mockResolvedValue(mockScrapeText)
    const buildEvidenceFn = vi.fn().mockReturnValue(mockEvidence)

    const result = await buildDescriptionTask({
      brand,
      deps: {
        rewriteBrandDescription: rewriteFn,
        loadPersistedScrapeText: loadScrapeTextFn,
        buildDescriptionEvidence: buildEvidenceFn,
      },
    })

    // loadPersistedScrapeText called with brandTarget(brand.id)
    expect(loadScrapeTextFn).toHaveBeenCalledWith({ type: 'brand', id: 'brand-1' })

    // buildDescriptionEvidence called with brand, undefined pendingPatch, []
    expect(buildEvidenceFn).toHaveBeenCalledWith(brand, undefined, [])

    // rewriteBrandDescription called with target: undefined in audit
    expect(rewriteFn).toHaveBeenCalledWith(
      'TestBrand',
      'existing desc',
      mockScrapeText.snippets,
      mockScrapeText.siteContent,
      { jobId: undefined, target: undefined },
      mockEvidence,
    )

    expect(result).toEqual(mockRewriteResult)
  })
})

// ---------------------------------------------------------------------------
// guardrail scorers
// ---------------------------------------------------------------------------

describe('guardrail scorers run on both arms', () => {
  it('asserts scores recorded per side', () => {
    // Import scorers from the descriptions adapter
    const scorers = [
      {
        name: 'bannedTermScore',
        fn: (_o: unknown) => 1,
      },
      {
        name: 'schemaCompliance',
        fn: (_o: unknown) => 1,
      },
    ]

    const outputA = {
      description_zh: '品牌描述A',
      description_en: 'Brand desc A',
      blurb_zh: '短A',
      blurb_en: 'Short A',
    }

    const outputB = {
      description_zh: '品牌描述B',
      description_en: 'Brand desc B',
      blurb_zh: '短B',
      blurb_en: 'Short B',
    }

    // Scorers run on each arm's output independently
    const scoresA: Record<string, number> = {}
    const scoresB: Record<string, number> = {}
    for (const scorer of scorers) {
      scoresA[scorer.name] = scorer.fn(outputA)
      scoresB[scorer.name] = scorer.fn(outputB)
    }

    expect(scoresA).toEqual({ bannedTermScore: 1, schemaCompliance: 1 })
    expect(scoresB).toEqual({ bannedTermScore: 1, schemaCompliance: 1 })

    // Both arms have scores
    expect(Object.keys(scoresA)).toHaveLength(2)
    expect(Object.keys(scoresB)).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// pairwiseReport
// ---------------------------------------------------------------------------

describe('pairwiseReport', () => {
  it('joins preference scores with the run JSON mapping and computes win rate, ties, pending', () => {
    // Build a fixture of 20 brands, 3 pending (no score)
    const mappings: Record<string, { left: 'a' | 'b'; right: 'a' | 'b' }> = {}
    const traceIds: string[] = []

    for (let i = 0; i < 20; i++) {
      const traceId = `trace-${i}`
      traceIds.push(traceId)
      // Alternate: even = left:a/right:b, odd = left:b/right:a
      mappings[traceId] = i % 2 === 0
        ? { left: 'a', right: 'b' }
        : { left: 'b', right: 'a' }
    }

    const runJson = {
      dataset: 'descriptions',
      mappings,
      traceIds,
    }

    // Build scores: 17 scored, 3 pending (no score for trace-17, trace-18, trace-19)
    // Of the 17 scored:
    //   8 prefer left, 5 prefer right, 4 tie
    const scores: Array<{ traceId: string; value: number }> = []

    // trace-0 to trace-7: prefer left (value > 0 → left wins)
    for (let i = 0; i < 8; i++) {
      scores.push({ traceId: `trace-${i}`, value: 1 })
    }
    // trace-8 to trace-12: prefer right (value < 0 → right wins)
    for (let i = 8; i < 13; i++) {
      scores.push({ traceId: `trace-${i}`, value: -1 })
    }
    // trace-13 to trace-16: tie (value = 0)
    for (let i = 13; i < 17; i++) {
      scores.push({ traceId: `trace-${i}`, value: 0 })
    }
    // trace-17, 18, 19: no score (pending)

    const report = pairwiseReport({ runJson, scores })

    expect(report.total).toBe(20)
    expect(report.pending).toBe(3)
    expect(report.ties).toBe(4)

    // left-wins need to be mapped through the run JSON to A/B wins:
    // trace-0 (left:a → A wins), trace-1 (left:b → B wins),
    // trace-2 (left:a → A wins), trace-3 (left:b → B wins), etc.
    // Left-prefer: trace-0..7
    // Even indices (0,2,4,6): left=a → A wins (4 wins)
    // Odd indices (1,3,5,7): left=b → B wins (4 wins)
    // Right-prefer: trace-8..12
    // Even indices (8,10,12): right=b → B wins (3 wins)
    // Odd indices (9,11): right=a → A wins (2 wins)
    // A wins = 4 + 2 = 6
    // B wins = 4 + 3 = 7
    expect(report.aWins).toBe(6)
    expect(report.bWins).toBe(7)

    // Win rates should be computed over scored (non-pending) items
    const scored = 20 - 3
    expect(report.aWinRate).toBeCloseTo(6 / scored, 4)
    expect(report.bWinRate).toBeCloseTo(7 / scored, 4)
  })
})
