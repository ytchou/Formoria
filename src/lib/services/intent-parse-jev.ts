/**
 * The Jev question set that parses a /discover?q= situation query into
 * { category, subcategory, materials } (DEV-1889). `parseQueryIntent` runs it
 * in production; `eval/jev-questions.ts` re-exports it as
 * `JEV_CANDIDATES.intentParse`, so the eval measures exactly this code.
 *
 * Step 1 asks the L1 choice plus one noul per material; step 2 asks the L2
 * choice within the chosen L1, and is skipped when the L1 is below
 * `INTENT_CATEGORY_MIN`.
 *
 * No Han text here (no-hardcoded-cjk guard): labels come from the taxonomy.
 */

import { MATERIALS } from '@/lib/taxonomy/ontology'
import type { ChoiceQuestion, NoulQuestion } from '@/lib/services/typesafe-client'
import {
  L1_SLUGS,
  l1MemberCriteria,
  l1Name,
  l2Criteria,
  pickChoice,
  requireChoice,
  runTwoStep,
  subcategoriesOf,
  type JevAnswers,
  type JevQuestions,
  type TwoStepJevCandidate,
} from './jev-candidate'

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** Keep the L1 only at P(L1) >= this; tuned on intent-parse-golden train+val 2026-09-28, DEV-1889; see docs/eval/archive/dev-1869/intent-threshold-tuning. */
export const INTENT_CATEGORY_MIN = 0.6
/** Keep the L2 only at P(L2) >= this; tuned on intent-parse-golden train+val 2026-09-28, DEV-1889; see docs/eval/archive/dev-1869/intent-threshold-tuning. */
export const INTENT_SUBCATEGORY_MIN = 0.9
/** A material noul counts as yes at p >= this; tuned on intent-parse-golden train+val 2026-09-28, DEV-1889; see docs/eval/archive/dev-1869/intent-threshold-tuning. */
export const INTENT_MATERIAL_MIN = 0.85

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IntentParseJevInput = { query: string }
export type IntentParseJevState = { query: string }
export type IntentParseJevOutput = {
  /** Null when P(L1) < `INTENT_CATEGORY_MIN`. */
  category: string | null
  /** Non-null only with a category and P(L2) >= `INTENT_SUBCATEGORY_MIN`. */
  subcategory: string | null
  materials: string[]
  /** P(L1), kept even when the category is dropped, for the eval threshold sweep. */
  probability: number
}

// ---------------------------------------------------------------------------
// Questions and decoding
// ---------------------------------------------------------------------------

function subcategoryQuestions(l1: string): JevQuestions {
  const criteria = l2Criteria(l1)
  if (Object.keys(criteria).length === 0) return {}
  const subcategory: ChoiceQuestion = {
    type: 'choice',
    instructions: `The shopper's search query is about ${l1Name(l1)}. Which subcategory is the query asking for?`,
    criteria,
  }
  return { subcategory }
}

function intentParseOutput(answers: JevAnswers): IntentParseJevOutput {
  const l1 = requireChoice(answers, 'category', L1_SLUGS)
  const materials = MATERIALS.filter((m) => (answers[m.slug]?.noul ?? 0) >= INTENT_MATERIAL_MIN).map((m) => m.slug)
  if (l1.p < INTENT_CATEGORY_MIN) {
    return { category: null, subcategory: null, materials, probability: l1.p }
  }
  const sub = pickChoice(answers.subcategory, new Set(subcategoriesOf(l1.key).map((s) => s.slug)))
  return {
    category: l1.key,
    subcategory: sub && sub.p >= INTENT_SUBCATEGORY_MIN ? sub.key : null,
    materials,
    probability: l1.p,
  }
}

export const intentParseJev: TwoStepJevCandidate<IntentParseJevInput, IntentParseJevState, IntentParseJevOutput> = {
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
        criteria: l1MemberCriteria(),
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
  /** Applies the three thresholds above. */
  toOutput(answers) {
    return intentParseOutput(answers)
  },
  /** Step 2: one L2 choice within the chosen L1; skipped when the L1 is dropped. */
  run(decide, input) {
    return runTwoStep(intentParseJev, decide, input, (first) => {
      const l1 = requireChoice(first, 'category', L1_SLUGS)
      return l1.p >= INTENT_CATEGORY_MIN ? subcategoryQuestions(l1.key) : {}
    })
  },
}
