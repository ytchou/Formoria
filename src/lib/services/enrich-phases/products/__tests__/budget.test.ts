import { describe, expect, it } from 'vitest'
import {
  budgetFor,
  assertBudget,
  PRODUCTS_BUDGET_CEILINGS,
  type ProductsBudgetState,
} from '../budget'
import { BudgetExhausted } from '../../acquisition/budget'

function makeState(overrides: Partial<ProductsBudgetState> = {}): ProductsBudgetState {
  return {
    allowed: { reads: 12, renders: 4, turns: 6, wallClockMs: 120_000 },
    used: { reads: 0, renders: 0, turns: 0, wallClockMs: 0 },
    ...overrides,
  }
}

describe('products/budget', () => {
  it('budgetFor_caps_reads_at_12', () => {
    const budget = budgetFor({ length: 20, needsRendering: 2 })
    expect(budget.reads).toBe(12)
  })

  it('budgetFor_caps_renders_at_4', () => {
    const budget = budgetFor({ length: 10, needsRendering: 6 })
    expect(budget.renders).toBe(4)
  })

  it('budgetFor_uses_pool_length_when_under_ceiling', () => {
    const budget = budgetFor({ length: 5, needsRendering: 2 })
    expect(budget.reads).toBe(5)
    expect(budget.renders).toBe(2)
  })

  it('budgetFor_always_applies_turn_and_wallClock_ceilings', () => {
    const budget = budgetFor({ length: 3, needsRendering: 1 })
    expect(budget.turns).toBe(PRODUCTS_BUDGET_CEILINGS.turns)
    expect(budget.wallClockMs).toBe(PRODUCTS_BUDGET_CEILINGS.wallClockMs)
  })

  it('assertBudget_throws_when_exhausted', () => {
    const state = makeState({
      used: { reads: 12, renders: 0, turns: 0, wallClockMs: 0 },
    })
    expect(() => assertBudget(state, 'reads')).toThrow(BudgetExhausted)

    try {
      assertBudget(state, 'reads')
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExhausted)
      expect((err as BudgetExhausted).kind).toBe('reads')
    }
  })

  it('assertBudget_does_not_throw_when_budget_remains', () => {
    const state = makeState({
      used: { reads: 5, renders: 2, turns: 3, wallClockMs: 60_000 },
    })
    expect(() => assertBudget(state, 'reads')).not.toThrow()
    expect(() => assertBudget(state, 'renders')).not.toThrow()
    expect(() => assertBudget(state, 'turns')).not.toThrow()
    expect(() => assertBudget(state, 'wallClockMs')).not.toThrow()
  })

  it('assertBudget_throws_for_each_kind', () => {
    expect(() => assertBudget(
      makeState({ used: { reads: 12, renders: 0, turns: 0, wallClockMs: 0 } }),
      'reads',
    )).toThrow(BudgetExhausted)

    expect(() => assertBudget(
      makeState({ used: { reads: 0, renders: 4, turns: 0, wallClockMs: 0 } }),
      'renders',
    )).toThrow(BudgetExhausted)

    expect(() => assertBudget(
      makeState({ used: { reads: 0, renders: 0, turns: 6, wallClockMs: 0 } }),
      'turns',
    )).toThrow(BudgetExhausted)

    expect(() => assertBudget(
      makeState({ used: { reads: 0, renders: 0, turns: 0, wallClockMs: 120_000 } }),
      'wallClockMs',
    )).toThrow(BudgetExhausted)
  })
})
