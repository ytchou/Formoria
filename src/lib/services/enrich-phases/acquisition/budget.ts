/**
 * Pure budget policy for the acquisition agent. All functions are side-effect
 * free — they read evidence and return numbers, or compare usage to allowance.
 */

export const BUDGET_CEILINGS = {
  probes: 8,
  renders: 3,
  search: 1,
  turns: 6,
  wallClockMs: 90_000,
} as const

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
export function budgetFor(pack: EvidencePack): AcquisitionBudget {
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

  // Turns = 2 + allowed renders + allowed searches, capped at 6
  const turns = Math.min(2 + renders + search, BUDGET_CEILINGS.turns)

  // Wall clock: 45s when no render/search; 90s otherwise
  const wallClockMs = (renders === 0 && search === 0) ? 45_000 : 90_000

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
