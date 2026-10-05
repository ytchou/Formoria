/**
 * Structural scorer for `llm-eval replay` (DEV-1917, design D9).
 *
 * Compares a fresh response with the stored production answer, both already
 * normalized to `NormalizedResponse` by the request module. One scorer serves
 * every step; the step's hint fields (`request-replay-steps.ts`) say which
 * leaves are key fields and which are prose.
 *
 * - Leaves (enum / string / boolean / null): exact match, 1 or 0.
 * - Arrays of primitives: set Jaccard. Arrays holding objects: set
 *   semantics too — each expected element is paired with its best-agreeing
 *   unused candidate element (see `pairElements`), then recursed. An element
 *   present on one side only, or a whole array missing on one side, scores
 *   a 0 leaf for every leaf of the present side, so key fields under the
 *   array (`entries[].preset_id`) count the miss.
 * - Numbers on both sides: absolute delta, reported, not counted.
 * - Prose fields: changed/unchanged plus lengths, never counted.
 * - Agreement = mean over the remaining leaves; key-field agreement = mean
 *   over the leaves under a hint key field. `null` means nothing to compare.
 * - Tool turns: calls paired by index; a missing call or a name mismatch is
 *   0, a same-name call scores its args as above; the turn is the call mean.
 */

import { jaccard } from './products-calibration'
import { mean } from './scorers'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One response, stored or fresh, after normalization. The scorer's input contract. */
export type NormalizedResponse =
  | { kind: 'json'; value: unknown }
  | { kind: 'tools'; calls: Array<{ name: string; args: unknown }> }
  | { kind: 'text'; value: string }

export type ScoreHints = {
  keyFields: readonly string[]
  proseFields: readonly string[]
}

type ProseFieldDiff = {
  path: string
  changed: boolean
  expectedLength: number
  candidateLength: number
}

type NumberDelta = { path: string; absDelta: number }

export type ReplayScore = {
  /** Mean leaf match over non-prose, non-number leaves; null when there are none. */
  agreement: number | null
  /** Mean leaf match over the hint key fields; null when none are present. */
  keyAgreement: number | null
  prose: ProseFieldDiff[]
  numberDeltas: NumberDelta[]
  /** The answer should have been JSON and the candidate's content did not parse. */
  parseFailed: boolean
}

type Leaf = { path: string; match: number }

type Accumulator = {
  leaves: Leaf[]
  prose: ProseFieldDiff[]
  numberDeltas: NumberDelta[]
}

// ---------------------------------------------------------------------------
// Structural walk
// ---------------------------------------------------------------------------

export function meanOrNull(values: number[]): number | null {
  return values.length === 0 ? null : mean(values)
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function missing(value: unknown): boolean {
  return value === null || value === undefined
}

function isPrimitive(value: unknown): boolean {
  return value === null || typeof value !== 'object'
}

function joinPath(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`
}

/** A missing key and an explicit null say the same thing in a strict-schema reply. */
function sameLeaf(expected: unknown, candidate: unknown): boolean {
  return (expected ?? null) === (candidate ?? null)
}

function proseText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function proseDiff(path: string, expected: unknown, candidate: unknown): ProseFieldDiff {
  const e = proseText(expected)
  const c = proseText(candidate)
  return {
    path,
    changed: e !== c,
    expectedLength: Array.from(e).length,
    candidateLength: Array.from(c).length,
  }
}

function walk(expected: unknown, candidate: unknown, path: string, hints: ScoreHints, acc: Accumulator): void {
  if (hints.proseFields.includes(path)) {
    acc.prose.push(proseDiff(path, expected, candidate))
    return
  }

  if (typeof expected === 'number' && typeof candidate === 'number') {
    acc.numberDeltas.push({ path, absDelta: Math.abs(expected - candidate) })
    return
  }

  // A missing side reads as empty, so an array or object present on one side
  // only still scores (as misses) every leaf it holds.
  if (Array.isArray(expected) || Array.isArray(candidate)) {
    const ea = Array.isArray(expected) ? expected : missing(expected) ? [] : null
    const ca = Array.isArray(candidate) ? candidate : missing(candidate) ? [] : null
    if (ea && ca) {
      walkArray(ea, ca, path, hints, acc)
      return
    }
  }

  const e = asRecord(expected) ?? (missing(expected) ? {} : null)
  const c = asRecord(candidate) ?? (missing(candidate) ? {} : null)
  if (e && c && (asRecord(expected) || asRecord(candidate))) {
    const keys = new Set([...Object.keys(e), ...Object.keys(c)])
    for (const key of keys) walk(e[key], c[key], joinPath(path, key), hints, acc)
    return
  }

  acc.leaves.push({ path, match: sameLeaf(expected, candidate) ? 1 : 0 })
}

function walkArray(expected: unknown[], candidate: unknown[], path: string, hints: ScoreHints, acc: Accumulator): void {
  if (expected.every(isPrimitive) && candidate.every(isPrimitive)) {
    const toSet = (values: unknown[]) => new Set(values.map((v) => JSON.stringify(v)))
    acc.leaves.push({ path, match: jaccard(toSet(expected), toSet(candidate)) })
    return
  }
  const elementPath = `${path}[]`
  const pairs = pairElements(expected, candidate, elementPath, hints)
  pairs.forEach((ci, ei) => walk(expected[ei], ci === null ? undefined : candidate[ci], elementPath, hints, acc))
  const used = new Set(pairs)
  candidate.forEach((c, ci) => {
    if (!used.has(ci)) walk(undefined, c, elementPath, hints, acc)
  })
}

/** Leaf agreement of one element pair, scored on a scratch accumulator; 0 when it has no counted leaf. */
function pairAgreement(expected: unknown, candidate: unknown, path: string, hints: ScoreHints): number {
  const scratch: Accumulator = { leaves: [], prose: [], numberDeltas: [] }
  walk(expected, candidate, path, hints, scratch)
  return meanOrNull(scratch.leaves.map((l) => l.match)) ?? 0
}

/**
 * For each expected element, the index of the candidate element it pairs
 * with, or null when none is left. Greedy: expected elements in order each
 * take the unused candidate with the highest leaf agreement, ties to the
 * lowest index — so an in-order list pairs as index pairing did, and a
 * reordered-but-equal list scores 1.
 *
 * Ceiling: greedy, not an optimal assignment, and O(n·m) trial walks. Fine for
 * the step replies (tens of elements); switch to a Hungarian assignment if a
 * step's arrays grow past a few hundred or greedy mispairs measurably.
 */
function pairElements(expected: unknown[], candidate: unknown[], path: string, hints: ScoreHints): Array<number | null> {
  const used = new Set<number>()
  return expected.map((e) => {
    let best: number | null = null
    let bestScore = -1
    for (let ci = 0; ci < candidate.length; ci++) {
      if (used.has(ci)) continue
      const score = pairAgreement(e, candidate[ci], path, hints)
      if (score > bestScore) {
        best = ci
        bestScore = score
      }
    }
    if (best !== null) used.add(best)
    return best
  })
}

function isUnderKeyField(path: string, keyFields: readonly string[]): boolean {
  return keyFields.some((key) => path === key || path.startsWith(`${key}.`) || path.startsWith(`${key}[]`))
}

function scoreValues(
  expected: unknown,
  candidate: unknown,
  hints: ScoreHints,
  acc: Accumulator,
): { agreement: number | null; keyAgreement: number | null } {
  const leafStart = acc.leaves.length
  walk(expected, candidate, '', hints, acc)
  const leaves = acc.leaves.slice(leafStart)
  return {
    agreement: meanOrNull(leaves.map((l) => l.match)),
    keyAgreement: meanOrNull(leaves.filter((l) => isUnderKeyField(l.path, hints.keyFields)).map((l) => l.match)),
  }
}

// ---------------------------------------------------------------------------
// scoreReplayResponse
// ---------------------------------------------------------------------------

function totalMiss(hints: ScoreHints, parseFailed: boolean): ReplayScore {
  return {
    agreement: 0,
    keyAgreement: hints.keyFields.length > 0 ? 0 : null,
    prose: [],
    numberDeltas: [],
    parseFailed,
  }
}

function scoreTools(
  expected: Extract<NormalizedResponse, { kind: 'tools' }>['calls'],
  candidate: Extract<NormalizedResponse, { kind: 'tools' }>['calls'],
  hints: ScoreHints,
): ReplayScore {
  const acc: Accumulator = { leaves: [], prose: [], numberDeltas: [] }
  const agreements: number[] = []
  const keyAgreements: number[] = []
  const keyMiss = hints.keyFields.length > 0

  for (let i = 0; i < Math.max(expected.length, candidate.length); i++) {
    const e = expected[i]
    const c = candidate[i]
    if (!e || !c || e.name !== c.name) {
      agreements.push(0)
      if (keyMiss) keyAgreements.push(0)
      continue
    }
    const call = scoreValues(e.args, c.args, hints, acc)
    if (call.agreement !== null) agreements.push(call.agreement)
    if (call.keyAgreement !== null) keyAgreements.push(call.keyAgreement)
  }

  return {
    agreement: meanOrNull(agreements),
    keyAgreement: meanOrNull(keyAgreements),
    prose: acc.prose,
    numberDeltas: acc.numberDeltas,
    parseFailed: false,
  }
}

/** Scores `candidate` (the fresh answer) against `expected` (production's stored answer). */
export function scoreReplayResponse(
  candidate: NormalizedResponse,
  expected: NormalizedResponse,
  hints: ScoreHints,
): ReplayScore {
  if (expected.kind === 'json' && candidate.kind === 'json') {
    const acc: Accumulator = { leaves: [], prose: [], numberDeltas: [] }
    const { agreement, keyAgreement } = scoreValues(expected.value, candidate.value, hints, acc)
    return { agreement, keyAgreement, prose: acc.prose, numberDeltas: acc.numberDeltas, parseFailed: false }
  }

  if (expected.kind === 'tools' && candidate.kind === 'tools') {
    return scoreTools(expected.calls, candidate.calls, hints)
  }

  if (expected.kind === 'text' && candidate.kind === 'text') {
    return {
      agreement: expected.value.trim() === candidate.value.trim() ? 1 : 0,
      keyAgreement: null,
      prose: [],
      numberDeltas: [],
      parseFailed: false,
    }
  }

  // A JSON answer whose candidate content did not parse (the normalizer turns
  // it into text) is a parse failure; any other kind mismatch is a plain miss.
  return totalMiss(hints, expected.kind === 'json' && candidate.kind === 'text')
}
