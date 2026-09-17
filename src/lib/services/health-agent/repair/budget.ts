/**
 * Repair budget — limits per investigation run.
 *
 * Mirrors `src/lib/services/enrich-phases/products/budget.ts` shape:
 * pure functions, no side effects.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum fix/validate cycles before escalating to needs_human. */
export const MAX_REPAIR_CYCLES = 2

/** Wall-clock deadline for a single investigation (5 minutes). */
export const INVESTIGATION_DEADLINE_MS = 300_000

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RepairBudgetState = {
  cyclesUsed: number
  wallClockStartMs: number
  deadlineMs: number
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createBudgetState(deadlineMs?: number): RepairBudgetState {
  return {
    cyclesUsed: 0,
    wallClockStartMs: Date.now(),
    deadlineMs: deadlineMs ?? INVESTIGATION_DEADLINE_MS,
  }
}

export function cyclesExhausted(state: RepairBudgetState): boolean {
  return state.cyclesUsed >= MAX_REPAIR_CYCLES
}

export function wallClockExhausted(state: RepairBudgetState): boolean {
  return Date.now() - state.wallClockStartMs >= state.deadlineMs
}
