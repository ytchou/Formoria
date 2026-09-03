import { describe, expect, it } from 'vitest'
import {
  budgetFor,
  assertBudget,
  BudgetExhausted,
  BUDGET_CEILINGS,
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
    expect(budget.wallClockMs).toBe(45_000)
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
})
