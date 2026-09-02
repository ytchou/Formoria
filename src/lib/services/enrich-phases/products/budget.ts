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
 * Throws `BudgetExhausted` if the next use of `kind` would exceed the allowed
 * budget. Call before each tool invocation or LLM turn.
 */
export function assertBudget(state: ProductsBudgetState, kind: ProductsBudgetKind): void {
  if (state.used[kind] >= state.allowed[kind]) {
    throw new BudgetExhausted(kind as BudgetKind)
  }
}
