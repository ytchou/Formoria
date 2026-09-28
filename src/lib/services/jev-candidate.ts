/**
 * Shared shape and helpers for a Jev candidate: one input becomes a Jev
 * `state` plus typed questions, and the answers become a typed output.
 * Production candidates (`intent-parse-jev.ts`) and the eval question bank
 * (`eval/jev-questions.ts`) both build on this module, so the eval measures
 * the same decoding production runs. Production code must never import `eval/`.
 *
 * No Han text here (no-hardcoded-cjk guard): labels come from the taxonomy.
 */

import { L1_CATEGORIES, L2_SUBCATEGORIES } from '@/lib/taxonomy/ontology'
import type { DecideResult } from '@/lib/services/typesafe-audit'
import type { JevAnswer, JevQuestion, JevState, JevUsage } from '@/lib/services/typesafe-client'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JevAnswers = Record<string, JevAnswer>
export type JevQuestions = Record<string, JevQuestion>

/** `decide()` from typesafe-audit.ts, injected so tests and callers choose the transport. */
export type DecideFn = (
  profileKey: string,
  state: JevState,
  questions: JevQuestions,
) => Promise<DecideResult>

export type JevCandidate<I, S extends JevState, O> = {
  profileKey: string
  buildState(input: I): S
  questions(state: S): JevQuestions
  toOutput(answers: JevAnswers): O
}

export type JevRunResult<O> = {
  output: O
  /** Answers from every call, merged. */
  answers: JevAnswers
  /** Summed over every call; null when any call's usage is unknown. */
  usage: JevUsage | null
  latencyMs: number
  /** Summed; null when any call's cost is unknown. */
  costUsd: number | null
}

export type TwoStepJevCandidate<I, S extends JevState, O> = JevCandidate<I, S, O> & {
  run(decide: DecideFn, input: I): Promise<JevRunResult<O>>
}

export const L1_SLUGS: ReadonlySet<string> = new Set(L1_CATEGORIES.map((c) => c.slug))

// ---------------------------------------------------------------------------
// Option descriptions — derived from the taxonomy, never hand-typed slugs
// ---------------------------------------------------------------------------

export function subcategoriesOf(l1: string) {
  return L2_SUBCATEGORIES.filter((s) => s.category === l1)
}

/**
 * Each L1 described by its own subcategory names. On intent-parse-golden this beat
 * the `CATEGORY_LIST` examples (category 0.885 -> 0.929, DEV-1887).
 */
export function l1MemberCriteria(): Record<string, string> {
  return Object.fromEntries(
    L1_CATEGORIES.map((c) => [
      c.slug,
      `${c.nameZh}（${c.name}）：${subcategoriesOf(c.slug).map((s) => s.nameZh).join('、')}`,
    ]),
  )
}

/** Same gloss as `SUBCATEGORY_VOCAB_BLOCK`: zh name, English name, aliases. */
export function l2Criteria(l1: string): Record<string, string> {
  return Object.fromEntries(
    subcategoriesOf(l1).map((s) => [
      s.slug,
      `${s.nameZh}（${s.nameEn}）${s.aliases.length > 0 ? `：${s.aliases.join('、')}` : ''}`,
    ]),
  )
}

export function l1Name(slug: string): string {
  const c = L1_CATEGORIES.find((cat) => cat.slug === slug)
  return c ? `${c.nameZh}（${c.name}）` : slug
}

// ---------------------------------------------------------------------------
// Answer decoding
// ---------------------------------------------------------------------------

export type Pick = { key: string; p: number }

/**
 * The chosen option and its probability. When `allowed` is given, a choice
 * outside it is ignored and the best allowed option by probability is used.
 */
export function pickChoice(answer: JevAnswer | undefined, allowed?: ReadonlySet<string>): Pick | null {
  if (!answer) return null
  const probs = answer.probabilities ?? {}
  let key = answer.choice
  if (key === undefined || (allowed && !allowed.has(key))) {
    key = undefined
    let best = -1
    for (const [k, p] of Object.entries(probs)) {
      if ((!allowed || allowed.has(k)) && p > best) {
        best = p
        key = k
      }
    }
  }
  if (key === undefined) return null
  return { key, p: probs[key] ?? (key === answer.choice ? answer.confidence ?? 0 : 0) }
}

export function requireChoice(answers: JevAnswers, questionKey: string, allowed: ReadonlySet<string>): Pick {
  const pick = pickChoice(answers[questionKey], allowed)
  if (!pick) throw new Error(`jev-candidate: no usable choice for "${questionKey}"`)
  return pick
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

function sumUsage(runs: DecideResult[]): JevUsage | null {
  let inputTokens = 0
  let outputTokens = 0
  for (const { usage } of runs) {
    if (!usage) return null
    inputTokens += usage.inputTokens
    outputTokens += usage.outputTokens
  }
  return { inputTokens, outputTokens }
}

export function combineRuns<O>(runs: DecideResult[], output: O, answers: JevAnswers): JevRunResult<O> {
  const costs = runs.map((r) => r.costUsd)
  return {
    output,
    answers,
    usage: sumUsage(runs),
    latencyMs: runs.reduce((sum, r) => sum + r.latencyMs, 0),
    costUsd: costs.some((c) => c === null) ? null : costs.reduce<number>((sum, c) => sum + (c ?? 0), 0),
  }
}

/**
 * The two-step flow: step 1 asks the candidate's own questions; `stepTwo`
 * derives the follow-up questions from its answers. No follow-up questions
 * means one call.
 */
export async function runTwoStep<I, S extends JevState, O>(
  candidate: JevCandidate<I, S, O>,
  decide: DecideFn,
  input: I,
  stepTwo: (first: JevAnswers) => JevQuestions,
): Promise<JevRunResult<O>> {
  const state = candidate.buildState(input)
  const first = await decide(candidate.profileKey, state, candidate.questions(state))
  const followUp = stepTwo(first.answers)
  if (Object.keys(followUp).length === 0) {
    return combineRuns([first], candidate.toOutput(first.answers), first.answers)
  }
  const second = await decide(candidate.profileKey, state, followUp)
  const answers = { ...first.answers, ...second.answers }
  return combineRuns([first, second], candidate.toOutput(answers), answers)
}
