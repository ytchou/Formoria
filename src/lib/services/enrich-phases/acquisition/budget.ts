/**
 * Pure budget policy for the acquisition agent. All functions are side-effect
 * free — they read evidence and return numbers, or compare usage to allowance.
 */

export const BUDGET_CEILINGS = {
  probes: 8,
  renders: 3,
  search: 1,
  turns: 6,
  wallClockMs: 180_000,
} as const

/** Reserved tail for critique + finalize — must-complete nodes. */
export const RESERVED_TAIL_MS = 35_000

/** Wall-clock extension per batch of 10 stored images. */
export const IMAGE_BATCH_EXTENSION_MS = 15_000

/** Base wall clock before per-probe scaling. */
export const BASE_WALL_CLOCK_MS = 60_000

/** Additional wall clock per probe result. */
export const PER_PROBE_MS = 1_500

/**
 * Per-node allowance table (ms). Images depends on stored count, so the table
 * stores a function for it; every other entry is a flat number.
 */
export const NODE_ALLOWANCE_MS = {
  gather: 10_000,
  plan: 45_000,
  execute: 30_000,
  images: (storedCount: number) => IMAGE_BATCH_EXTENSION_MS * Math.max(1, Math.ceil(storedCount / 10)),
  critique: 30_000,
  recover: 30_000,
  imagesRecover: 20_000,
  finalize: 30_000,
} as const

/** Absolute ceiling at the given scale. */
export function ceilingMs(scale = 1): number {
  return BUDGET_CEILINGS.wallClockMs * scale
}

export type AcquisitionBudget = {
  probes: number
  renders: number
  search: number
  turns: number
  wallClockMs: number
}

export type BudgetKind = keyof AcquisitionBudget

export type BudgetState = {
  allowed: AcquisitionBudget
  used: AcquisitionBudget
}

export type ProbeResult = {
  url: string
  textLength: number
  needsRendering: boolean
}

export type EvidencePack = {
  knownUrls: string[]
  probeResults: ProbeResult[]
}

export class BudgetExhausted extends Error {
  readonly kind: BudgetKind
  constructor(kind: BudgetKind) {
    super(`Budget exhausted: ${kind}`)
    this.name = 'BudgetExhausted'
    this.kind = kind
  }
}

/**
 * Pure function that computes an acquisition budget from the evidence gathered
 * during the initial probe phase. It can only LOWER ceilings, never exceed them.
 */
export function budgetFor(
  pack: EvidencePack,
  options?: { scale?: number },
): AcquisitionBudget {
  const scale = options?.scale ?? 1
  const urlCount = pack.knownUrls.length

  // Count URLs that need JS rendering (empty/too-short text or social/aggregator)
  const renderNeeded = pack.probeResults.filter((r) => r.needsRendering).length

  // Every probe returned real static text?
  const allStaticOk = pack.probeResults.length > 0 &&
    pack.probeResults.every((r) => r.textLength >= 200 && !r.needsRendering)

  // No known URLs or every probe was empty/third-party → search allowed
  const everyProbeEmpty = pack.probeResults.length > 0 &&
    pack.probeResults.every((r) => r.textLength < 200)
  const search = (urlCount === 0 || everyProbeEmpty) ? 1 : 0

  // Renders = count of URLs known to need rendering, capped at ceiling
  const renders = allStaticOk ? 0 : Math.min(renderNeeded, BUDGET_CEILINGS.renders)

  // Probes = known URLs + 2 fan-out, capped at 8
  const probes = Math.min(urlCount + 2, BUDGET_CEILINGS.probes)

  // Turns = 3 + allowed renders + allowed searches, capped at 6. Three model
  // STAGES always fit: the plan, the critique, and the critique that re-reads a
  // recovery. At 2 the recovery critique never ran, and any brand whose plan
  // stage needed its json-mode fallback lost the first critique as well.
  const turns = Math.min(3 + renders + search, BUDGET_CEILINGS.turns)

  // Wall clock: 90s when render/search budgeted; otherwise BASE + PER_PROBE × probes
  const rawWallClockMs = (renders > 0 || search > 0)
    ? 90_000
    : BASE_WALL_CLOCK_MS + PER_PROBE_MS * pack.probeResults.length
  const wallClockMs = Math.min(rawWallClockMs * scale, ceilingMs(scale))

  return {
    probes,
    renders,
    search,
    turns,
    wallClockMs,
  }
}

/**
 * Throws `BudgetExhausted` if the next use of `kind` would exceed the allowed
 * budget. Call before each tool invocation or LLM turn.
 */
export function assertBudget(state: BudgetState, kind: BudgetKind): void {
  if (state.used[kind] >= state.allowed[kind]) {
    throw new BudgetExhausted(kind)
  }
}
