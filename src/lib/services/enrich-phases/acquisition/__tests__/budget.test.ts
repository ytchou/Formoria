import { describe, expect, it } from 'vitest'
import {
  budgetFor,
  assertBudget,
  BudgetExhausted,
  BUDGET_CEILINGS,
  RESERVED_TAIL_MS,
  IMAGE_BATCH_EXTENSION_MS,
  BASE_WALL_CLOCK_MS,
  PER_PROBE_MS,
  ceilingMs,
  type BudgetState,
  type EvidencePack,
} from '../budget'

function makeState(overrides: Partial<BudgetState> = {}): BudgetState {
  return {
    allowed: { probes: 8, renders: 3, search: 1, turns: 6, wallClockMs: 90_000 },
    used: { probes: 0, renders: 0, search: 0, turns: 0, wallClockMs: 0 },
    ...overrides,
  }
}

describe('budget', () => {
  it('budget_exhaustion_throws_typed_error_per_kind', () => {
    // 9th probe
    expect(() => assertBudget(
      makeState({ used: { probes: 8, renders: 0, search: 0, turns: 0, wallClockMs: 0 } }),
      'probes',
    )).toThrow(BudgetExhausted)

    // 4th render
    expect(() => assertBudget(
      makeState({ used: { probes: 0, renders: 3, search: 0, turns: 0, wallClockMs: 0 } }),
      'renders',
    )).toThrow(BudgetExhausted)

    // 2nd search
    expect(() => assertBudget(
      makeState({ used: { probes: 0, renders: 0, search: 1, turns: 0, wallClockMs: 0 } }),
      'search',
    )).toThrow(BudgetExhausted)

    // 7th turn
    expect(() => assertBudget(
      makeState({ used: { probes: 0, renders: 0, search: 0, turns: 6, wallClockMs: 0 } }),
      'turns',
    )).toThrow(BudgetExhausted)

    // Verify the kind is stored
    try {
      assertBudget(
        makeState({ used: { probes: 8, renders: 0, search: 0, turns: 0, wallClockMs: 0 } }),
        'probes',
      )
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExhausted)
      expect((err as BudgetExhausted).kind).toBe('probes')
    }
  })

  it('budget_policy_static_site_gets_zero_renders_and_no_search', () => {
    const pack: EvidencePack = {
      knownUrls: ['https://example.com'],
      probeResults: [{ url: 'https://example.com', textLength: 2000, needsRendering: false }],
    }
    const budget = budgetFor(pack)
    expect(budget.renders).toBe(0)
    expect(budget.search).toBe(0)
    // plan + critique + the critique that re-reads a recovery.
    expect(budget.turns).toBe(3)
    // BASE_WALL_CLOCK_MS (60_000) + PER_PROBE_MS (1_500) × 1 probe = 61_500
    expect(budget.wallClockMs).toBe(61_500)
  })

  it('budget_wall_clock_grows_with_probe_results', () => {
    // 4 probe results, all static => BASE + 4 × PER_PROBE = 60_000 + 6_000 = 66_000
    const staticPack: EvidencePack = {
      knownUrls: ['https://a.com', 'https://b.com', 'https://c.com', 'https://d.com'],
      probeResults: [
        { url: 'https://a.com', textLength: 2000, needsRendering: false },
        { url: 'https://b.com', textLength: 2000, needsRendering: false },
        { url: 'https://c.com', textLength: 2000, needsRendering: false },
        { url: 'https://d.com', textLength: 2000, needsRendering: false },
      ],
    }
    expect(budgetFor(staticPack).wallClockMs).toBe(66_000)

    // With renders or search budgeted => 90_000
    const renderPack: EvidencePack = {
      knownUrls: ['https://a.com', 'https://b.com', 'https://c.com', 'https://d.com'],
      probeResults: [
        { url: 'https://a.com', textLength: 0, needsRendering: true },
        { url: 'https://b.com', textLength: 2000, needsRendering: false },
        { url: 'https://c.com', textLength: 2000, needsRendering: false },
        { url: 'https://d.com', textLength: 2000, needsRendering: false },
      ],
    }
    expect(budgetFor(renderPack).wallClockMs).toBe(90_000)
  })

  it('budget_scale_applies_to_allowance_and_ceiling', () => {
    const pack: EvidencePack = {
      knownUrls: ['https://example.com'],
      probeResults: [{ url: 'https://example.com', textLength: 2000, needsRendering: false }],
    }
    // 1 probe: BASE + PER_PROBE = 61_500, × 1.5 = 92_250
    const budget = budgetFor(pack, { scale: 1.5 })
    expect(budget.wallClockMs).toBe(92_250)
    expect(ceilingMs(1.5)).toBe(270_000)
  })

  it('budget_never_exceeds_scaled_ceiling', () => {
    // 200 probe results: BASE + 200 × PER_PROBE = 60_000 + 300_000 = 360_000 > ceiling
    const pack: EvidencePack = {
      knownUrls: Array.from({ length: 200 }, (_, i) => `https://url${i}.com`),
      probeResults: Array.from({ length: 200 }, (_, i) => ({
        url: `https://url${i}.com`,
        textLength: 2000,
        needsRendering: false,
      })),
    }
    const budget = budgetFor(pack)
    expect(budget.wallClockMs).toBeLessThanOrEqual(ceilingMs(1))
    expect(ceilingMs(1)).toBe(180_000)
  })

  it('budget_policy_instagram_only_gets_render_and_search', () => {
    const pack: EvidencePack = {
      knownUrls: ['https://instagram.com/brand'],
      probeResults: [{ url: 'https://instagram.com/brand', textLength: 0, needsRendering: true }],
    }
    const budget = budgetFor(pack)
    expect(budget.renders).toBe(1)
    expect(budget.search).toBe(1)
    expect(budget.turns).toBe(5)
  })

  it('budget_policy_never_exceeds_ceilings', () => {
    // 10 JS-shell URLs
    const urls = Array.from({ length: 10 }, (_, i) => `https://shell${i}.example.com`)
    const pack: EvidencePack = {
      knownUrls: urls,
      probeResults: urls.map((url) => ({ url, textLength: 0, needsRendering: true })),
    }
    const budget = budgetFor(pack)
    expect(budget.renders).toBeLessThanOrEqual(BUDGET_CEILINGS.renders)
    expect(budget.probes).toBeLessThanOrEqual(BUDGET_CEILINGS.probes)
    expect(budget.search).toBeLessThanOrEqual(BUDGET_CEILINGS.search)
    expect(budget.turns).toBeLessThanOrEqual(BUDGET_CEILINGS.turns)
    expect(budget.wallClockMs).toBeLessThanOrEqual(BUDGET_CEILINGS.wallClockMs)

    // Property-like: random-ish packs
    for (let i = 0; i < 20; i++) {
      const n = Math.floor(Math.random() * 12) + 1
      const randomUrls = Array.from({ length: n }, (_, j) => `https://r${j}.example.com`)
      const randomPack: EvidencePack = {
        knownUrls: randomUrls,
        probeResults: randomUrls.map((url) => ({
          url,
          textLength: Math.random() > 0.5 ? 2000 : 0,
          needsRendering: Math.random() > 0.5,
        })),
      }
      const b = budgetFor(randomPack)
      expect(b.probes).toBeLessThanOrEqual(BUDGET_CEILINGS.probes)
      expect(b.renders).toBeLessThanOrEqual(BUDGET_CEILINGS.renders)
      expect(b.search).toBeLessThanOrEqual(BUDGET_CEILINGS.search)
      expect(b.turns).toBeLessThanOrEqual(BUDGET_CEILINGS.turns)
      expect(b.wallClockMs).toBeLessThanOrEqual(BUDGET_CEILINGS.wallClockMs)
    }
  })

  it('exports_expected_constants', () => {
    expect(RESERVED_TAIL_MS).toBe(35_000)
    expect(IMAGE_BATCH_EXTENSION_MS).toBe(15_000)
    expect(BASE_WALL_CLOCK_MS).toBe(60_000)
    expect(PER_PROBE_MS).toBe(1_500)
    expect(BUDGET_CEILINGS.wallClockMs).toBe(180_000)
  })
})
