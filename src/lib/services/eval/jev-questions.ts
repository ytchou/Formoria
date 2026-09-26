/**
 * Jev question sets for the six DEV-1824 eval candidates. Each candidate turns
 * one eval input into a Jev `state` plus typed questions, and turns Jev answers
 * back into the output shape the existing scorers read, plus a `probability`
 * for the calibration sweep. Eval-only: no production call site imports this.
 *
 * Input shapes, probed 2026-09-26 against staging (step 0 of the plan). Field
 * labels are named by their `JEV_INPUT_LABELS` / `SITE_IDENTITY_LABELS` key,
 * because this file may not carry Han text (no-hardcoded-cjk guard).
 *
 * - `detect-confidence-golden` (12 ACTIVE): `input = { user, promptName: 'detect' }`.
 *   `user` is the live chat message (`category-classifier.ts#detectBrand`), one
 *   `<label>：<value>` line each for brandSlug, brandName, description, website and
 *   searchSnippets (snippets joined by a full-width semicolon), then up to four
 *   `probe` lines. A missing description or website is written as `missingValue`.
 * - `category-confidence-golden` (12 ACTIVE): `input = { user, promptName: 'category-classify' }`,
 *   `user` = brandName and description lines.
 * - `site-identity-confidence-golden` (22 ACTIVE): `input = { user, promptName: 'site-identity' }`,
 *   `user` = `userPreamble`, newline, then `1. [<slug>] ` and " / "-joined fields: brandName,
 *   optional categorySlug, a bare subjectKind label, url, title, description, story
 *   (`site-identity-arbiter.ts`). A value may itself contain " / ".
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
 * All three Langfuse golden inputs are flat prompt strings, not JSON, so the
 * state builders parse the labelled fields back out of `user`.
 */

import { SITE_IDENTITY_LABELS } from '@/lib/prompts'
import { JEV_INPUT_LABELS } from '@/lib/prompts/jev'
import { CATEGORY_LIST, RELEVANCE_GRADE_LEVELS } from '@/lib/prompts/shared'
import {
  L1_CATEGORIES,
  L2_SUBCATEGORIES,
  MATERIALS,
} from '@/lib/taxonomy/ontology'
import type { DecideResult } from '@/lib/services/typesafe-audit'
import type {
  ChoiceQuestion,
  JevAnswer,
  JevQuestion,
  JevState,
  JevUsage,
  NoulQuestion,
  ScoreQuestion,
} from '@/lib/services/typesafe-client'
import { bandFromProbability, type ConfidenceBand } from './scorers'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** A noul verdict is "yes" at p >= 0.5 (plan tweakable decision 2). */
const NOUL_TRUE_AT = 0.5
/** productCategory keeps the top K L1s and asks one L2 choice per L1 (decision 3). */
const PRODUCT_BEAM_K = 3
/** intentParse keeps the L2 only at this confidence; below it, L1 only (decision 4). */
const INTENT_SUBCATEGORY_MIN = 0.9
/** Same cap as the OpenAI judge's user message. */
const RELEVANCE_DESCRIPTION_MAX = 600

const L1_SLUGS: ReadonlySet<string> = new Set(L1_CATEGORIES.map((c) => c.slug))

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JevAnswers = Record<string, JevAnswer>
type JevQuestions = Record<string, JevQuestion>

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

type JevRunResult<O> = {
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
type ClassificationOutput = { category: string; confidence: ConfidenceBand; probability: number }

type SiteIdentityState = {
  brandName: string | null
  categorySlug: string | null
  subjectKind: 'website' | 'source-page' | null
  url: string | null
  title: string | null
  description: string | null
  story: string | null
}
type SiteIdentityOutput = { owned: boolean; confidence: ConfidenceBand; probability: number }

type ProductCategoryOutput = {
  category: string
  subcategory: string | null
  confidence: ConfidenceBand
  /** Joint P(L1) * P(L2 | L1), or P(L1) when no L2 answer is usable. */
  probability: number
}

type IntentParseInput = { query: string }
type IntentParseState = { query: string }
type IntentParseOutput = {
  category: string
  subcategory: string | null
  materials: string[]
  /** P(L1). */
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
// Option descriptions — derived from the taxonomy, never hand-typed slugs
// ---------------------------------------------------------------------------

/** `CATEGORY_LIST` is `- <slug>: <examples>` per line; reuse its examples as descriptions. */
const L1_EXAMPLES = new Map(
  CATEGORY_LIST.split('\n').flatMap((line) => {
    const match = /^- ([^:]+): (.+)$/.exec(line)
    return match ? [[match[1]!, match[2]!] as const] : []
  }),
)

function l1Criteria(): Record<string, string> {
  return Object.fromEntries(
    L1_CATEGORIES.map((c) => [
      c.slug,
      `${c.nameZh}（${c.name}）：${L1_EXAMPLES.get(c.slug) ?? c.nameZh}`,
    ]),
  )
}

function subcategoriesOf(l1: string) {
  return L2_SUBCATEGORIES.filter((s) => s.category === l1)
}

/** Same gloss as `SUBCATEGORY_VOCAB_BLOCK`: zh name, English name, aliases. */
function l2Criteria(l1: string): Record<string, string> {
  return Object.fromEntries(
    subcategoriesOf(l1).map((s) => [
      s.slug,
      `${s.nameZh}（${s.nameEn}）${s.aliases.length > 0 ? `：${s.aliases.join('、')}` : ''}`,
    ]),
  )
}

function l1Name(slug: string): string {
  const c = L1_CATEGORIES.find((cat) => cat.slug === slug)
  return c ? `${c.nameZh}（${c.name}）` : slug
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

const SITE_FIELD_LABELS = {
  brandName: SITE_IDENTITY_LABELS.brandName,
  categorySlug: SITE_IDENTITY_LABELS.categorySlug,
  url: SITE_IDENTITY_LABELS.url,
  title: SITE_IDENTITY_LABELS.title,
  description: SITE_IDENTITY_LABELS.description,
  story: SITE_IDENTITY_LABELS.story,
} as const

/** Parses the first (and, in the golden set, only) numbered candidate of a site-identity message. */
function parseSiteIdentity(text: string): SiteIdentityState {
  const body = text.startsWith(SITE_IDENTITY_LABELS.userPreamble)
    ? text.slice(SITE_IDENTITY_LABELS.userPreamble.length).trim()
    : text.trim()
  const candidate = body.replace(/^\d+\. \[[^\]]*\] /, '')
  const fieldLabels = Object.values(SITE_FIELD_LABELS)
  const kindLabels = Object.entries(SITE_IDENTITY_LABELS.subjectKind)

  // " / " separates fields, but a value may contain it: a segment that opens no
  // known field belongs to the previous one.
  const parts: string[] = []
  for (const segment of candidate.split(' / ')) {
    const opensField =
      fieldLabels.some((l) => segment.startsWith(`${l}：`)) ||
      kindLabels.some(([, label]) => segment === label)
    if (opensField || parts.length === 0) parts.push(segment)
    else parts[parts.length - 1] += ` / ${segment}`
  }

  const valueOf = (label: string) => {
    const part = parts.find((p) => p.startsWith(`${label}：`))
    return valueOrNull(part?.slice(label.length + 1))
  }
  const kind = kindLabels.find(([, label]) => parts.includes(label))?.[0]
  return {
    brandName: valueOf(SITE_FIELD_LABELS.brandName),
    categorySlug: valueOf(SITE_FIELD_LABELS.categorySlug),
    subjectKind: kind === 'website' || kind === 'source-page' ? kind : null,
    url: valueOf(SITE_FIELD_LABELS.url),
    title: valueOf(SITE_FIELD_LABELS.title),
    description: valueOf(SITE_FIELD_LABELS.description),
    story: valueOf(SITE_FIELD_LABELS.story),
  }
}

// ---------------------------------------------------------------------------
// Answer decoding
// ---------------------------------------------------------------------------

type Pick = { key: string; p: number }

/**
 * The chosen option and its probability. When `allowed` is given, a choice
 * outside it is ignored and the best allowed option by probability is used.
 */
function pickChoice(answer: JevAnswer | undefined, allowed?: ReadonlySet<string>): Pick | null {
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

function requireChoice(answers: JevAnswers, questionKey: string, allowed: ReadonlySet<string>): Pick {
  const pick = pickChoice(answers[questionKey], allowed)
  if (!pick) throw new Error(`jev-questions: no usable choice for "${questionKey}"`)
  return pick
}

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

function combineRuns<O>(runs: DecideResult[], output: O, answers: JevAnswers): JevRunResult<O> {
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
 * The two-step flow shared by productCategory and intentParse: step 1 asks the
 * candidate's own questions; `stepTwo` derives the follow-up questions from its
 * answers. No follow-up questions means one call.
 */
async function runTwoStep<I, S extends JevState, O>(
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
  profileKey: 'detectBatch',
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
// classification (brand L1)
// ---------------------------------------------------------------------------

const BRAND_TEXT_LABELS = { name: JEV_INPUT_LABELS.brandName, description: JEV_INPUT_LABELS.description } as const

const classification: JevCandidate<GoldenChatInput, BrandTextState, ClassificationOutput> = {
  profileKey: 'classificationBatch',
  buildState(input) {
    const fields = parseLabelledLines(userText(input), Object.values(BRAND_TEXT_LABELS))
    return {
      name: valueOrNull(fields[BRAND_TEXT_LABELS.name]),
      description: valueOrNull(fields[BRAND_TEXT_LABELS.description]),
    }
  },
  questions() {
    const category: ChoiceQuestion = {
      type: 'choice',
      instructions: [
        "Classify this Taiwanese brand by its core product line, using only its name and description (no outside knowledge). If it spans several categories, pick the primary product line's category.",
        'Scented candles are beauty, not home. Leather wallets are bags-accessories, not fashion. Ceramic teapots are home, not food-drink.',
      ].join(' '),
      criteria: l1Criteria(),
    }
    return { category }
  },
  toOutput(answers) {
    const { key, p } = requireChoice(answers, 'category', L1_SLUGS)
    return { category: key, confidence: bandFromProbability(p), probability: p }
  },
}

// ---------------------------------------------------------------------------
// siteIdentity
// ---------------------------------------------------------------------------

const siteIdentity: JevCandidate<GoldenChatInput, SiteIdentityState, SiteIdentityOutput> = {
  profileKey: 'siteIdentityBatch',
  buildState(input) {
    return parseSiteIdentity(userText(input))
  },
  questions() {
    const owned: NoulQuestion = {
      type: 'noul',
      instructions:
        "Does this candidate page belong to the brand — a page the brand itself operates — rather than a third-party page that mentions, sells or aggregates it? Judge by the semantic fit between the page content and the brand's name and product type, not by string similarity to the domain.",
      criteria: {
        true: 'The page is operated by the brand itself. For a scraped source page, the page shows it is content operated by the brand itself.',
        false: 'An e-commerce platform, retailer or marketplace product page; news, media, blog or review pages; directory listings, brand lists, price-comparison or search-aggregation pages; parked, expired or for-sale domains; a same-name company with a different product type.',
      },
    }
    return { owned }
  },
  toOutput(answers) {
    const { yes, probability } = noulVerdict(answers, 'owned')
    return { owned: yes, confidence: bandFromProbability(probability), probability }
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
      criteria: l1Criteria(),
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
// intentParse (L1 + materials, then L2 with coarsening)
// ---------------------------------------------------------------------------

function intentSubcategoryQuestions(l1: string): JevQuestions {
  const criteria = l2Criteria(l1)
  if (Object.keys(criteria).length === 0) return {}
  const subcategory: ChoiceQuestion = {
    type: 'choice',
    instructions: `The shopper's search query is about ${l1Name(l1)}. Which subcategory is the query asking for?`,
    criteria,
  }
  return { subcategory }
}

function intentParseOutput(answers: JevAnswers): IntentParseOutput {
  const category = requireChoice(answers, 'category', L1_SLUGS)
  const sub = pickChoice(answers.subcategory, new Set(subcategoriesOf(category.key).map((s) => s.slug)))
  return {
    category: category.key,
    subcategory: sub && sub.p >= INTENT_SUBCATEGORY_MIN ? sub.key : null,
    materials: MATERIALS.filter((m) => (answers[m.slug]?.noul ?? 0) >= NOUL_TRUE_AT).map((m) => m.slug),
    probability: category.p,
  }
}

const intentParse: TwoStepJevCandidate<IntentParseInput, IntentParseState, IntentParseOutput> = {
  profileKey: 'intentParse',
  buildState(input) {
    return { query: input.query }
  },
  /** Step 1: the L1 choice plus one noul per material, keyed by the material slug. */
  questions() {
    const questions: JevQuestions = {
      category: {
        type: 'choice',
        instructions:
          "A shopper typed this situation query into a directory of Taiwanese products. Which product category is the query asking for?",
        criteria: l1Criteria(),
      },
    }
    for (const m of MATERIALS) {
      const question: NoulQuestion = {
        type: 'noul',
        instructions: `Does the query ask for products made of ${m.nameZh} (${m.nameEn})?`,
        criteria: {
          true: 'The query names this material or clearly implies it.',
          false: 'The material is absent, or only a product kind, occasion or technique is mentioned. A product kind, occasion or technique alone is not a material.',
        },
      }
      questions[m.slug] = question
    }
    return questions
  },
  /** Keeps the L1; drops the L2 below `INTENT_SUBCATEGORY_MIN`; materials at p >= 0.5. */
  toOutput(answers) {
    return intentParseOutput(answers)
  },
  /** Step 2: one L2 choice within the chosen L1. */
  run(decide, input) {
    return runTwoStep(intentParse, decide, input, (first) =>
      intentSubcategoryQuestions(requireChoice(first, 'category', L1_SLUGS).key),
    )
  },
}

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
  classification,
  siteIdentity,
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
