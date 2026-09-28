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
 * - `detect-confidence-golden` (12 ACTIVE): `input = { user, promptName: 'detect' }`.
 *   `user` is the live chat message (`category-classifier.ts#detectBrand`), one
 *   `<label>：<value>` line each for brandSlug, brandName, description, website and
 *   searchSnippets (snippets joined by a full-width semicolon), then up to four
 *   `probe` lines. A missing description or website is written as `missingValue`.
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
 */

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
  searchSnippets: string | null
  /** Probe lines, newline-joined; null when the message has none. */
  probes: string | null
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
function parseLabelledLines(text: string, labels: readonly string[]): Record<string, string> {
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

/** A noul verdict plus the probability of that verdict (not of "yes"). */
function noulVerdict(answers: JevAnswers, questionKey: string): { yes: boolean; probability: number } {
  const p = answers[questionKey]?.noul
  if (typeof p !== 'number') throw new Error(`jev-questions: no noul answer for "${questionKey}"`)
  const yes = p >= NOUL_TRUE_AT
  return { yes, probability: yes ? p : 1 - p }
}

// ---------------------------------------------------------------------------
// detect
// ---------------------------------------------------------------------------

const DETECT_LABELS = {
  name: JEV_INPUT_LABELS.brandName,
  description: JEV_INPUT_LABELS.description,
  website: JEV_INPUT_LABELS.website,
  snippets: JEV_INPUT_LABELS.searchSnippets,
  probe: JEV_INPUT_LABELS.probe,
} as const

const detect: JevCandidate<GoldenChatInput, DetectState, DetectOutput> = {
  profileKey: 'detect',
  buildState(input) {
    // The submission slug is dropped: it carries no evidence about the entity.
    const fields = parseLabelledLines(userText(input), [...Object.values(DETECT_LABELS), JEV_INPUT_LABELS.brandSlug])
    return {
      name: valueOrNull(fields[DETECT_LABELS.name]),
      description: valueOrNull(fields[DETECT_LABELS.description]),
      website: valueOrNull(fields[DETECT_LABELS.website]),
      searchSnippets: valueOrNull(fields[DETECT_LABELS.snippets]),
      probes: valueOrNull(fields[DETECT_LABELS.probe]),
    }
  },
  questions() {
    const isNonBrand: NoulQuestion = {
      type: 'noul',
      instructions: [
        'A submission to Formoria, a directory of Taiwanese product brands. From the name, optional description and website, and search-result snippets: is this entity definitionally NOT a product brand?',
        'Do not judge whether the brand is Taiwanese or how good it is.',
      ].join(' '),
      criteria: {
        true: 'It is clearly one of: a proxy buyer or personal shopper; a curated or multi-brand shop with no product line of its own; a marketplace, platform or retail channel; a media, blog or review site; a distributor or importer of foreign brands; an event, market or fair; an individual creator with no productised physical goods.',
        false: [
          'A curated shop also has its own product line; an illustrator or character IP has at least one self-designed physical product; a named founder sells physical products under a brand name.',
          'Uncertainty is never a yes: sparse, ambiguous or possibly-different-entity snippets mean no.',
        ].join(' '),
      },
    }
    return { isNonBrand }
  },
  toOutput(answers) {
    const { yes, probability } = noulVerdict(answers, 'isNonBrand')
    return { isNonBrand: yes, confidence: bandFromProbability(probability), probability }
  },
}

// ---------------------------------------------------------------------------
// names (brand-name arbitration: a choice over the supplied candidate names)
// ---------------------------------------------------------------------------

const NAME_LABELS = {
  stored: JEV_INPUT_LABELS.storedName,
  candidates: JEV_INPUT_LABELS.nameCandidates,
  snippets: JEV_INPUT_LABELS.searchSnippets,
} as const

type NamesState = {
  storedName: string
  /** One line per distinct candidate: `<name> <- <sources>`. */
  candidates: string
  searchSnippets: string | null
}
type NamesOutput = { chosen: string | null; confidence: ConfidenceBand; probability: number }

/**
 * `name-arbiter.ts#buildNameArbiterUserContent` renders one brand as
 * `N. [slug] <stored>：X / <candidates>：src：v；src：v / <snippets>：a；b`.
 * Fields split on ` / ` followed by a known label, so a ` / ` inside a name stays
 * whole. A candidate's first-party evidence is a trailing `（official_… url …）`.
 */
function parseNameArbiterLine(text: string): { stored: string; candidates: Map<string, string[]>; snippets: string | null } {
  const line = text.split('\n').find((l) => /^\d+\. \[[^\]]*\] /.test(l))
  if (!line) throw new Error('jev-questions: no name-arbiter item line in the input')
  const body = line.replace(/^\d+\. \[[^\]]*\] /, '')
  const labels = Object.values(NAME_LABELS)
  const fields: Record<string, string> = {}
  let current: string | null = null
  for (const segment of body.split(' / ')) {
    const label = labels.find((l) => segment.startsWith(`${l}：`))
    if (label) {
      current = label
      fields[label] = segment.slice(label.length + 1)
    } else if (current) {
      fields[current] += ` / ${segment}`
    }
  }
  const stored = (fields[NAME_LABELS.stored] ?? '').trim()
  const candidates = new Map<string, string[]>()
  const add = (value: string, source: string) => {
    const v = value.trim()
    if (!v) return
    candidates.set(v, [...(candidates.get(v) ?? []), source])
  }
  add(stored, 'stored')
  const list = valueOrNull(fields[NAME_LABELS.candidates])
  for (const entry of list ? list.split('；') : []) {
    const match = /^([a-z_]+)：(.*)$/.exec(entry.trim())
    if (!match) continue
    const evidenceAt = match[2]!.lastIndexOf('（official_')
    const value = evidenceAt >= 0 && match[2]!.endsWith('）') ? match[2]!.slice(0, evidenceAt) : match[2]!
    const evidence = evidenceAt >= 0 ? match[2]!.slice(evidenceAt + 1, -1) : null
    add(value, evidence ? `${match[1]} (${evidence})` : match[1]!)
  }
  return { stored, candidates, snippets: valueOrNull(fields[NAME_LABELS.snippets]) }
}

const names: JevCandidate<GoldenChatInput, NamesState, NamesOutput> = {
  profileKey: 'names',
  buildState(input) {
    const { stored, candidates, snippets } = parseNameArbiterLine(userText(input))
    return {
      storedName: stored,
      candidates: [...candidates].map(([value, sources]) => `${value} <- ${sources.join(', ')}`).join('\n'),
      searchSnippets: snippets,
    }
  },
  questions(state) {
    const name: ChoiceQuestion = {
      type: 'choice',
      instructions: [
        "Formoria lists Taiwanese brands. Which candidate is this brand's formal name, as the brand itself uses it?",
        'Judge by meaning, not string shape: a trailing maker suffix (studio, workshop) is part of the name; a trailing tagline, SEO copy, page-title chrome or product-category description is not.',
        'Keep both halves of a bilingual name only when a candidate already has both; never prefer a candidate that drops an identity half, and differing capitalisation alone keeps the capitalisation the brand uses.',
        'A candidate that may be a different entity (a parent company, a legal name, another brand sharing a word) is not the name; when unsure, keep the stored name.',
      ].join(' '),
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
    return { chosen: pick?.key ?? null, confidence: bandFromProbability(p), probability: p }
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
