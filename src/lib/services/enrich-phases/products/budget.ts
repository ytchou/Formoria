/**
 * Pure budget policy for the products agent. All functions are side-effect
 * free — they read pool sizes and return numbers, or compare usage to allowance.
 */

import { BudgetExhausted } from '../acquisition/budget'
import type { BudgetKind } from '../acquisition/budget'

export const PRODUCTS_BUDGET_CEILINGS = {
  reads: 12,
  renders: 4,
  turns: 6,
  wallClockMs: 120_000,
} as const

export type ProductsBudget = {
  reads: number
  renders: number
  turns: number
  wallClockMs: number
}

export type ProductsBudgetKind = keyof ProductsBudget

export type ProductsBudgetState = {
  allowed: ProductsBudget
  used: ProductsBudget
}

/**
 * Pure function that computes a products budget from the candidate pool.
 * It can only LOWER ceilings, never exceed them.
 *
 * `needsRendering` must be a count of pages a probe actually found to need a
 * render. The first call site passed `pool.filter(() => false).length` — a
 * hard-coded zero — which set the renders allowance to zero and made the whole
 * render path unreachable (DEV-1644 F24). When no probe ran, pass zero and let
 * `allowRenderFor` grow the allowance from what the reads observe.
 */
export function budgetFor(pool: { length: number; needsRendering: number }): ProductsBudget {
  return {
    reads: Math.min(pool.length, PRODUCTS_BUDGET_CEILINGS.reads),
    renders: Math.min(pool.needsRendering, PRODUCTS_BUDGET_CEILINGS.renders),
    turns: PRODUCTS_BUDGET_CEILINGS.turns,
    wallClockMs: PRODUCTS_BUDGET_CEILINGS.wallClockMs,
  }
}

/**
 * Whether one more render is affordable, growing the allowance to cover a page
 * the reads have just discovered to be a JS shell.
 *
 * `budgetFor` can only size the renders allowance from a probe that ran BEFORE
 * any page was read, and the products phase has no such probe — it learns which
 * pages need rendering by reading them. So the allowance is raised one page at a
 * time, in step with the evidence, and never past `PRODUCTS_BUDGET_CEILINGS`.
 * That ceiling, not the allowance, is what refuses the fifth render.
 *
 * Mutates `state.allowed.renders`. `assertBudget` stays the hard gate.
 */
export function allowRenderFor(state: ProductsBudgetState): boolean {
  if (state.used.renders >= PRODUCTS_BUDGET_CEILINGS.renders) return false
  if (state.allowed.renders <= state.used.renders) {
    state.allowed.renders = Math.min(
      state.used.renders + 1,
      PRODUCTS_BUDGET_CEILINGS.renders,
    )
  }
  return state.used.renders < state.allowed.renders
}

/**
 * Throws `BudgetExhausted` if the next use of `kind` would exceed the allowed
 * budget. Call before each tool invocation or LLM turn.
 */
export function assertBudget(state: ProductsBudgetState, kind: ProductsBudgetKind): void {
  if (state.used[kind] >= state.allowed[kind]) {
    throw new BudgetExhausted(kind as BudgetKind)
  }
}
