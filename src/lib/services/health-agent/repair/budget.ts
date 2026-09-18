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


