/**
 * Jev question sets for the DEV-1824 eval candidates. Each candidate turns
 * one eval input into a Jev `state` plus typed questions, and turns Jev answers
 * back into the output shape the existing scorers read, plus a `probability`
 * for the calibration sweep. Eval-only, except `intentParse`: that candidate
 * lives in production (`intent-parse-jev.ts`, DEV-1889) and is re-exported here
 * so the eval measures exactly what `/discover?q=` runs. The shared candidate
 * types and decoding helpers live in `jev-candidate.ts`. Production code never
 * imports this file.
 *
 * Input shapes, probed 2026-09-26 against staging (step 0 of the plan). Field
 * labels are named by their `JEV_INPUT_LABELS` key, because this file may not
 * carry Han text (no-hardcoded-cjk guard).
 *
 * - `detect-confidence-golden`: `input = { user, promptName: 'detect' }`, and the
 *   eval adapter adds `rules` (the pinned `detect` prompt text, DEV-1894 D13).
 *   `user` is `category-classifier.ts#renderDetectUserMessage`: one
 *   `<label>：<value>` line each for brandSlug, brandName, description, website and
 *   submittedWebsite, then one searchResult line per result (up to 10) and up to
 *   four probe lines. A missing value is written as `missingValue`.
 * - `situation-search-v2.json` (156 queries): `{ id, query, category, queryType, split,
 *   expected: [{ brandSlug, productKey, grade }] }`. `intent-parse-golden` items are
 *   seeded from it as `input = { query }`.
 * - `labels/holdout-grades.csv`: `query_id, query, brand_slug, product_key, name_zh,
 *   description_zh, official_url, llm_grade, hybrid_rank, rerank_rank, cohere_rank,
 *   disagreement, human_grade`. The judge input is `{ query, product: { name_zh, … } }`,
 *   the `judgeRelevance` input.
 * - Distillation `eval.jsonl` user message (productCategory): productName and
 *   description lines (`scripts/distillation/export-training-data.ts`).
 *
 * The detect golden input and the distillation message are flat prompt
 * strings, not JSON, so their state builders parse the labelled fields back out.
 * The names golden input is the arbiter's own user message, parsed with the
 * shared production inverse via `parseSingleNameArbiterUser` (DEV-1896).
 *
 * names instructions are luna's name-arbiter snapshot rule text (rules plus
 * golden anchors), so the comparison runs on matched instructions (DEV-1896).
 * The confidence rubric and the response format are removed. The rubric is the
 * one intended difference from luna: Jev's band comes from its probability,
 * via `NAMES_HIGH_MIN` / `NAMES_MEDIUM_MIN`, not from a self-reported label.
 */

import { snapshotPrompt } from '@/lib/langfuse/prompt'
import { JEV_INPUT_LABELS } from '@/lib/prompts/jev'
import { RELEVANCE_GRADE_LEVELS } from '@/lib/prompts/shared'
import { L1_CATEGORIES } from '@/lib/taxonomy/ontology'
import type {
  ChoiceQuestion,
  JevAnswer,
  JevState,
  NoulQuestion,
  ScoreQuestion,
} from '@/lib/services/typesafe-client'
import {
  L1_SLUGS,
  combineRuns,
  l1MemberCriteria,
  l1Name,
  l2Criteria,
  pickChoice,
  requireChoice,
  runTwoStep,
  subcategoriesOf,
  type DecideFn,
  type JevAnswers,
  type JevCandidate,
  type JevQuestions,
  type JevRunResult,
  type TwoStepJevCandidate,
} from '@/lib/services/jev-candidate'
import { intentParseJev } from '@/lib/services/intent-parse-jev'
import { parseSingleNameArbiterUser } from '@/lib/services/name-arbiter'
import { bandAt } from './names-shipped'
import { bandFromProbability, type ConfidenceBand } from './scorers'

export type { DecideFn, JevAnswers, JevCandidate, TwoStepJevCandidate } from '@/lib/services/jev-candidate'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** A noul verdict is "yes" at p >= 0.5 (plan tweakable decision 2). */
const NOUL_TRUE_AT = 0.5
/** productCategory keeps the top K L1s and asks one L2 choice per L1 (decision 3). */
const PRODUCT_BEAM_K = 3
/** Same cap as the OpenAI judge's user message. */
const RELEVANCE_DESCRIPTION_MAX = 600

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------


/** A golden chat input: the stored `{ user, promptName }` item input, or the bare user message. */
type GoldenChatInput = string | { user: string; promptName?: string }

type DetectState = {
  name: string | null
  description: string | null
  website: string | null
  submittedWebsite: string | null
  /** Search-result lines, newline-joined; null when the message has none. */
  searchResults: string | null
  /** Probe lines, newline-joined; null when the message has none. */
  probes: string | null
  /** The sliced detect prompt rules (`detectRuleSections`) every question carries. */
  rules: string
}
type DetectOutput = { isNonBrand: boolean; confidence: ConfidenceBand; probability: number }

type BrandTextState = { name: string | null; description: string | null }

type ProductCategoryOutput = {
  category: string
  subcategory: string | null
  confidence: ConfidenceBand
  /** Joint P(L1) * P(L2 | L1), or P(L1) when no L2 answer is usable. */
  probability: number
}

type RelevanceProduct = {
  name_zh: string
  name_en?: string | null
  category_zh?: string | null
  subcategory_zh?: string | null
  materials_zh?: string | null
  description_zh?: string | null
}
type RelevanceJudgeInput = { query: string; product: RelevanceProduct }
type RelevanceJudgeState = { query: string; product: Partial<RelevanceProduct> }
/** Spreads into `judgeRelevance`'s `JudgeResult`. */
type RelevanceJudgeOutput = {
  grade: number | null
  votes: number[]
  unanimous: boolean
  split: boolean
  probabilities?: Record<string, number>
}

// ---------------------------------------------------------------------------
// Relevance levels
// ---------------------------------------------------------------------------


/**
 * The most probable relevance level from a score answer's per-level probabilities.
 * `score` is a probability-weighted value, which drifts toward the middle levels;
 * argmax reads the single most likely grade. A tie goes to the lower, stricter level.
 */
export function argmaxGrade(probabilities: Record<string, number> | undefined): number | null {
  let best: { grade: number; p: number } | null = null
  for (const [key, p] of Object.entries(probabilities ?? {})) {
    const grade = Number(key)
    if (!Number.isInteger(grade) || grade < 0 || grade >= RELEVANCE_GRADE_LEVELS.length) continue
    if (!best || p > best.p || (p === best.p && grade < best.grade)) best = { grade, p }
  }
  return best ? best.grade : null
}

/** Level index = grade 0..3, so Jev's zero-indexed score equals the grade. */
function relevanceCriteria(): string[] {
  return [...RELEVANCE_GRADE_LEVELS]
}

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

function userText(input: GoldenChatInput): string {
  if (typeof input === 'string') return input
  if (input && typeof input.user === 'string') return input.user
  throw new Error('jev-questions: expected a golden input with a `user` message string')
}

/** The live builders write `missingValue` for a missing value. */
function valueOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed && trimmed !== JEV_INPUT_LABELS.missingValue ? trimmed : null
}

/**
 * Splits a `<label>：<value>` per-line message on the known labels only, so a `：`
 * inside a value never opens a new field. A repeated label (probe lines) collects
 * its values newline-joined. An unlabelled line continues the previous field, so
 * a multi-line description stays whole; every label the templates emit must be
 * in `labels`, or its lines leak into the field before them.
 */
export function parseLabelledLines(text: string, labels: readonly string[]): Record<string, string> {
  const fields: Record<string, string> = {}
  let current: string | null = null
  for (const line of text.split('\n')) {
    const label = labels.find((l) => line.startsWith(`${l}：`))
    if (label) {
      current = label
      const value = line.slice(label.length + 1)
      fields[label] = label in fields ? `${fields[label]}\n${value}` : value
    } else if (current && line.trim()) {
      fields[current] += `\n${line}`
    }
  }
  return fields
}

// ---------------------------------------------------------------------------
// Answer decoding
// ---------------------------------------------------------------------------

/** P(option) for a choice answer: its probability, else the confidence when it is the choice. */
function optionProbability(answer: JevAnswer | undefined, key: string): number {
  if (!answer) return 0
  return answer.probabilities?.[key] ?? (answer.choice === key ? answer.confidence ?? 0 : 0)
}

/** Top-k allowed options by probability; the choice alone when no probabilities came back. */
function topChoices(answer: JevAnswer | undefined, allowed: ReadonlySet<string>, k: number): string[] {
  if (!answer) return []
  const ranked = Object.entries(answer.probabilities ?? {})
    .filter(([key]) => allowed.has(key))
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key)
  if (ranked.length === 0 && answer.choice && allowed.has(answer.choice)) return [answer.choice]
  return ranked.slice(0, k)
}

/** Reads a noul answer's P(yes); throws when the answer is missing. */
function noulP(answers: JevAnswers, questionKey: string): number {
  const p = answers[questionKey]?.noul
  if (typeof p !== 'number') throw new Error(`jev-questions: no noul answer for "${questionKey}"`)
  return p
}

// ---------------------------------------------------------------------------
// detect
// ---------------------------------------------------------------------------

const DETECT_LABELS = {
  name: JEV_INPUT_LABELS.brandName,
  description: JEV_INPUT_LABELS.description,
  website: JEV_INPUT_LABELS.website,
  submittedWebsite: JEV_INPUT_LABELS.submittedWebsite,
  searchResult: JEV_INPUT_LABELS.searchResult,
  probe: JEV_INPUT_LABELS.probe,
} as const

/** The detect prompt sections every Jev question carries (D13), in prompt order. */
const DETECT_KEPT_SECTIONS = ['## Not a product brand', '## Input', '## Golden anchors'] as const

/**
 * The detect prompt sliced by `## ` heading: the intro (text before the first
 * heading) plus the Not-a-product-brand, Input and Golden-anchors sections.
 * Confidence, Slug and Brand name are dropped: they govern outputs Jev does not
 * produce. Throws when the Not-a-product-brand section is missing, so a renamed
 * heading fails loudly instead of silently shipping rules without the definition.
 */
export function detectRuleSections(text: string): string {
  const sections: Array<{ heading: string | null; lines: string[] }> = [{ heading: null, lines: [] }]
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) sections.push({ heading: line.trim(), lines: [line] })
    else sections[sections.length - 1]!.lines.push(line)
  }
  if (!sections.some((s) => s.heading === DETECT_KEPT_SECTIONS[0])) {
    throw new Error(`jev-questions: detect rules have no "${DETECT_KEPT_SECTIONS[0]}" section`)
  }
  return sections
    .filter((s) => s.heading === null || (DETECT_KEPT_SECTIONS as readonly string[]).includes(s.heading))
    .map((s) => s.lines.join('\n').trim())
    .filter(Boolean)
    .join('\n\n')
}

/** The detect golden input after the eval adapter injects the pinned prompt text. */
type DetectInput = string | { user: string; promptName?: string; rules?: string }

function detectRules(input: DetectInput): string {
  const rules = typeof input === 'object' && input ? input.rules : undefined
  if (typeof rules !== 'string' || !rules.trim()) {
    throw new Error('jev-questions: detect input has no `rules`; the candidate never runs on hand-written rules')
  }
  return detectRuleSections(rules)
}

/**
 * Detect as three noul questions in one call (DEV-1894 D11), each carrying the
 * same rules sliced from the pinned detect prompt (D13), then a one-line stem.
 *
 * Intended differences from the luna (prompt) arm, reported with the eval:
 * the confidence band comes from `probability` via `bandFromProbability`, not
 * from the prompt's Confidence section; and there is no brand-name or slug
 * output (D13; "slug if detect switches to Jev" is the open item D14).
 */
const detect: JevCandidate<DetectInput, DetectState, DetectOutput> = {
  profileKey: 'detect',
  buildState(input) {
    const rules = detectRules(input)
    // The submission slug is dropped: it carries no evidence about the entity.
    // The pre-DEV-1894 snippet label is listed so an old-format line never
    // continues the website field; its snippets count as search results.
    const fields = parseLabelledLines(userText(input), [
      ...Object.values(DETECT_LABELS),
      JEV_INPUT_LABELS.brandSlug,
      JEV_INPUT_LABELS.searchSnippets,
    ])
    const searchResults = [fields[DETECT_LABELS.searchResult], fields[JEV_INPUT_LABELS.searchSnippets]]
      .map(valueOrNull)
      .filter((value): value is string => value !== null)
    return {
      name: valueOrNull(fields[DETECT_LABELS.name]),
      description: valueOrNull(fields[DETECT_LABELS.description]),
      website: valueOrNull(fields[DETECT_LABELS.website]),
      submittedWebsite: valueOrNull(fields[DETECT_LABELS.submittedWebsite]),
      searchResults: searchResults.length > 0 ? searchResults.join('\n') : null,
      probes: valueOrNull(fields[DETECT_LABELS.probe]),
      rules,
    }
  },
  questions(state) {
    const ask = (stem: string, criteria: { true: string; false: string }): NoulQuestion => ({
      type: 'noul',
      instructions: `${state.rules}\n\n${stem}`,
      criteria,
    })
    return {
      aboutEntity: ask(
        'Do the search results and probes describe this submitted entity (not a different one with a similar name)?',
        { true: 'Yes: the evidence is about this entity.', false: 'No: the evidence is about a different entity, or there is none.' },
      ),
      nonBrandType: ask('Is this entity one of the non-brand types listed above?', {
        true: 'Yes: it is one of the listed non-brand types.',
        false: 'No: it is not one of the listed non-brand types.',
      }),
      ownProductLine: ask('Does this entity sell at least one physical product under its own brand name?', {
        true: 'Yes: it sells at least one physical product under its own brand name.',
        false: 'No: it sells no physical product under its own brand name.',
      }),
    }
  },
  /** P(non-brand) = P(about) * P(type) * (1 - P(own)) (D11), cut at `NOUL_TRUE_AT`. */
  toOutput(answers) {
    const pNonBrand =
      noulP(answers, 'aboutEntity') * noulP(answers, 'nonBrandType') * (1 - noulP(answers, 'ownProductLine'))
    const isNonBrand = pNonBrand >= NOUL_TRUE_AT
    const probability = isNonBrand ? pNonBrand : 1 - pNonBrand
    return { isNonBrand, confidence: bandFromProbability(probability), probability }
  },
}

// ---------------------------------------------------------------------------
// names (brand-name arbitration: a choice over the supplied candidate names)
// ---------------------------------------------------------------------------

type NamesState = {
  storedName: string
  /** One line per distinct candidate: `<name> <- <sources>`. */
  candidates: string
  searchSnippets: string | null
}
type NamesOutput = { chosen: string | null; confidence: ConfidenceBand; probability: number }

/**
 * Band a names pick at p >= this as high. Tuned on name-arbiter-confidence-golden train+val
 * (88 items, DEV-1896): shipped-name agreement 76/88 = 0.864, the best of the 0.50-0.95 grid;
 * see docs/eval/archive/dev-1869/names-rerun/sweep.md. The optimum sits at the grid floor:
 * any stricter gate only sends correct Jev renames back to the stored name.
 */
export const NAMES_HIGH_MIN = 0.55
/** Band a names pick at p >= this (and below `NAMES_HIGH_MIN`) as medium; tuned with `NAMES_HIGH_MIN` (DEV-1896, same sweep). */
export const NAMES_MEDIUM_MIN = 0.5

/** Same banding the offline cutoff sweep uses, so the tuned cutoffs mean the same thing here. */
function namesBand(p: number): ConfidenceBand {
  return bandAt(p, NAMES_HIGH_MIN, NAMES_MEDIUM_MIN)
}

function headingLine(lines: readonly string[], heading: string): number {
  const at = lines.findIndex((l) => l.startsWith(heading))
  if (at < 0) throw new Error(`jev-questions: name-arbiter prompt has no "${heading}" heading`)
  return at
}

/**
 * The name-arbiter prompt text minus its confidence rubric (from `Confidence rubric:`
 * up to `Golden anchors:`) and its response format (from `Response format` to the
 * end). Throws when any of the three headings is missing, so a prompt edit that
 * renames one fails the eval instead of silently shipping the rubric to Jev.
 */
export function sliceNameArbiterInstructions(text: string): string {
  const lines = text.split('\n')
  const rubric = headingLine(lines, 'Confidence rubric:')
  const anchors = headingLine(lines, 'Golden anchors:')
  const response = headingLine(lines, 'Response format')
  if (!(rubric < anchors && anchors < response)) {
    throw new Error('jev-questions: name-arbiter prompt headings are out of order')
  }
  return [...lines.slice(0, rubric), ...lines.slice(anchors, response)].join('\n').trimEnd()
}

let namesInstructions: string | null = null
function nameArbiterInstructions(): string {
  namesInstructions ??= sliceNameArbiterInstructions(snapshotPrompt('name-arbiter').text)
  return namesInstructions
}

/**
 * Parses the single item line of a name-arbiter user message with the shared
 * production inverse, and groups candidates by value: stored first, then each
 * candidate with its sources (first-party evidence rendered as
 * `source (official_… url observed="…")`).
 */
function parseNamesInput(text: string): { stored: string; candidates: Map<string, string[]>; snippets: string | null } {
  const parsed = parseSingleNameArbiterUser(text)
  if (!parsed) throw new Error('jev-questions: input does not hold exactly one name-arbiter item line')
  const stored = parsed.storedName.trim()
  const candidates = new Map<string, string[]>()
  const add = (value: string, source: string) => {
    const v = value.trim()
    if (!v) return
    candidates.set(v, [...(candidates.get(v) ?? []), source])
  }
  add(stored, 'stored')
  for (const candidate of parsed.candidates) {
    const evidence = candidate.evidence
      ?.map((e) => `${e.source} ${e.url} observed=${JSON.stringify(e.observedName)}`)
      .join(', ')
    add(candidate.value, evidence ? `${candidate.source} (${evidence})` : candidate.source)
  }
  return { stored, candidates, snippets: valueOrNull(parsed.snippets.join('\uff1b')) }
}

const names: JevCandidate<GoldenChatInput, NamesState, NamesOutput> = {
  profileKey: 'names',
  buildState(input) {
    const { stored, candidates, snippets } = parseNamesInput(userText(input))
    return {
      storedName: stored,
      candidates: [...candidates].map(([value, sources]) => `${value} <- ${sources.join(', ')}`).join('\n'),
      searchSnippets: snippets,
    }
  },
  questions(state) {
    const name: ChoiceQuestion = {
      type: 'choice',
      instructions: nameArbiterInstructions(),
      criteria: Object.fromEntries(
        state.candidates.split('\n').map((l) => {
          const at = l.lastIndexOf(' <- ')
          return [l.slice(0, at), `Proposed by: ${l.slice(at + 4)}`]
        }),
      ),
    }
    return { name }
  },
  toOutput(answers) {
    const pick = pickChoice(answers.name)
    const p = pick?.p ?? 0
    return { chosen: pick?.key ?? null, confidence: namesBand(p), probability: p }
  },
}

// ---------------------------------------------------------------------------
// productCategory (product L1 -> L2, beam K=3)
// ---------------------------------------------------------------------------

const PRODUCT_LABELS = { name: JEV_INPUT_LABELS.productName, description: JEV_INPUT_LABELS.description } as const

function productL2Key(l1: string): string {
  return `l2_${l1.replace(/-/g, '_')}`
}

function productL2Questions(l1Slugs: readonly string[]): JevQuestions {
  const questions: JevQuestions = {}
  for (const l1 of l1Slugs) {
    const criteria = l2Criteria(l1)
    if (Object.keys(criteria).length === 0) continue
    const question: ChoiceQuestion = {
      type: 'choice',
      instructions: `Assume this product belongs to ${l1Name(l1)}. Which subcategory is it? Judge only from its name and description.`,
      criteria,
    }
    questions[productL2Key(l1)] = question
  }
  return questions
}

function productCategoryOutput(answers: JevAnswers): ProductCategoryOutput {
  let best: { category: string; subcategory: string; probability: number } | null = null
  for (const c of L1_CATEGORIES) {
    const l2Answer = answers[productL2Key(c.slug)]
    if (!l2Answer) continue
    // Only an L2 of this L1 counts; a foreign L2 is never picked.
    const pick = pickChoice(l2Answer, new Set(subcategoriesOf(c.slug).map((s) => s.slug)))
    if (!pick) continue
    const joint = optionProbability(answers.l1, c.slug) * pick.p
    if (!best || joint > best.probability) best = { category: c.slug, subcategory: pick.key, probability: joint }
  }
  if (best) return { ...best, confidence: bandFromProbability(best.probability) }
  const l1 = requireChoice(answers, 'l1', L1_SLUGS)
  return { category: l1.key, subcategory: null, confidence: bandFromProbability(l1.p), probability: l1.p }
}

const productCategory: TwoStepJevCandidate<GoldenChatInput, BrandTextState, ProductCategoryOutput> & {
  l2Key(l1: string): string
} = {
  profileKey: 'productCategory',
  buildState(input) {
    const fields = parseLabelledLines(userText(input), Object.values(PRODUCT_LABELS))
    return {
      name: valueOrNull(fields[PRODUCT_LABELS.name]),
      description: valueOrNull(fields[PRODUCT_LABELS.description]),
    }
  },
  /** Step 1: the L1 choice. */
  questions() {
    const l1: ChoiceQuestion = {
      type: 'choice',
      instructions:
        'Which product category does this Taiwanese product belong to? Judge by what the product is, using only its name and description.',
      criteria: l1MemberCriteria(),
    }
    return { l1 }
  },
  l2Key: productL2Key,
  /** Picks the max joint P(L1) * P(L2 | L1) over the L1s that have an L2 answer. */
  toOutput(answers) {
    return productCategoryOutput(answers)
  },
  /** Step 2: one L2 choice per beam L1, all in one call. */
  run(decide, input) {
    return runTwoStep(productCategory, decide, input, (first) =>
      productL2Questions(topChoices(first.l1, L1_SLUGS, PRODUCT_BEAM_K)),
    )
  },
}

// ---------------------------------------------------------------------------
// intentParse — the production candidate (`intent-parse-jev.ts`, DEV-1889)
// ---------------------------------------------------------------------------

const intentParse = intentParseJev

// ---------------------------------------------------------------------------
// relevanceJudge
// ---------------------------------------------------------------------------

const RELEVANCE_PRODUCT_FIELDS = [
  'name_zh',
  'name_en',
  'category_zh',
  'subcategory_zh',
  'materials_zh',
  'description_zh',
] as const satisfies ReadonlyArray<keyof RelevanceProduct>

const relevanceJudge: JevCandidate<RelevanceJudgeInput, RelevanceJudgeState, RelevanceJudgeOutput> = {
  profileKey: 'search_relevance_judge',
  /** The same fields, and the same description cap, as the OpenAI judge's user message. */
  buildState(input) {
    const product: Partial<RelevanceProduct> = {}
    for (const field of RELEVANCE_PRODUCT_FIELDS) {
      const value = input.product[field]
      if (!value) continue
      product[field] = field === 'description_zh' ? value.slice(0, RELEVANCE_DESCRIPTION_MAX) : value
    }
    return { query: input.query, product }
  },
  questions() {
    const grade: ScoreQuestion = {
      type: 'score',
      instructions: [
        "Grade how well the product matches the user's situation query, for Formoria, a directory of Taiwanese product brands.",
        'Judge the product only from the supplied fields (name, category, materials, description).',
        'Never reward brand size, popularity, market share, how well the page is written, or the brand\'s responsiveness or availability.',
        'Focus on functional fit: does this product solve or serve the stated situation?',
      ].join(' '),
      criteria: relevanceCriteria(),
    }
    return { grade }
  },
  toOutput(answers) {
    const answer = answers.grade
    if (typeof answer?.score !== 'number') {
      return { grade: null, votes: [], unanimous: false, split: false }
    }
    const last = RELEVANCE_GRADE_LEVELS.length - 1
    const grade = Math.min(last, Math.max(0, Math.round(answer.score)))
    return {
      grade,
      votes: [grade],
      unanimous: true,
      split: false,
      ...(answer.probabilities ? { probabilities: answer.probabilities } : {}),
    }
  },
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const JEV_CANDIDATES = {
  detect,
  names,
  productCategory,
  intentParse,
  relevanceJudge,
} as const

/**
 * Runs one candidate end to end: its own `run` for two-step candidates,
 * otherwise a single `decide` call.
 */
export async function runJevCandidate<I, S extends JevState, O>(
  candidate: JevCandidate<I, S, O> | TwoStepJevCandidate<I, S, O>,
  decide: DecideFn,
  input: I,
): Promise<JevRunResult<O>> {
  if ('run' in candidate) return candidate.run(decide, input)
  const state = candidate.buildState(input)
  const result = await decide(candidate.profileKey, state, candidate.questions(state))
  return combineRuns([result], candidate.toOutput(result.answers), result.answers)
}
