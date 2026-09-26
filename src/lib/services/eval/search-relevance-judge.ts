import { z } from 'zod'
import type { PromptMeta } from '@/lib/langfuse/prompt'
import { RELEVANCE_GRADE_LEVELS } from '@/lib/prompts/shared'
import type { OpenAIJsonSchema } from '@/lib/services/openai-client'
import {
  parseAndValidate,
  toStrictJsonSchema,
} from '@/lib/services/_shared/zod-schema'
import { JEV_CANDIDATES, runJevCandidate, type DecideFn } from './jev-questions'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type JudgeProduct = {
  name_zh: string
  name_en?: string | null
  category_zh?: string | null
  subcategory_zh?: string | null
  materials_zh?: string | null
  description_zh?: string | null
}

type JudgeResult = {
  grade: number | null // 0-3 or null if all malformed
  votes: number[]
  unanimous: boolean
  split: boolean
  reason?: string
  /** Jev path only: probability per grade level, keyed '0'..'3'. */
  probabilities?: Record<string, number>
}

type ChatFn = (opts: {
  system: string
  user: string
  schema?: OpenAIJsonSchema
}) => Promise<{ content: string }>

type FetchPromptFn = (name: string) => Promise<PromptMeta>

type JudgeDeps = {
  chat?: ChatFn
  fetchPrompt?: FetchPromptFn
  samples?: number
  temperature?: number
  /**
   * Eval-only Jev path (DEV-1824). When set, one `score` call replaces the
   * multi-sample chat vote; `chat`, `fetchPrompt`, `samples` and `temperature`
   * are ignored.
   */
  decide?: DecideFn
}

// ---------------------------------------------------------------------------
// Output schema
// ---------------------------------------------------------------------------

const JudgeOutputSchema = z.object({
  grade: z.number().int().min(0).max(3),
  reason: z.string(),
})

const JUDGE_JSON_SCHEMA = {
  name: 'relevance_grade',
  schema: toStrictJsonSchema(JudgeOutputSchema),
}

// ---------------------------------------------------------------------------
// Default system prompt (snapshot fallback)
// ---------------------------------------------------------------------------

const DEFAULT_SYSTEM_PROMPT = [
  'You are a search relevance judge for Formoria, a directory of Taiwanese product brands.',
  '',
  'Grade how well the product matches the user\'s situation query on a 0–3 scale:',
  '',
  ...RELEVANCE_GRADE_LEVELS.map((level, grade) => `- ${grade}: ${level}`).reverse(),
  '',
  '## Rules',
  '',
  '- Judge the product only from the supplied fields (name, category, materials, description).',
  '- Never reward brand size, popularity, market share, or how well the page is written.',
  '- Never reward responsiveness, availability, or speed of the brand.',
  '- Focus on functional fit: does this product solve or serve the stated situation?',
].join('\n')

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

export async function judgeRelevance(
  input: { query: string; product: JudgeProduct },
  deps: JudgeDeps = {},
): Promise<JudgeResult> {
  if (deps.decide) {
    const { output } = await runJevCandidate(JEV_CANDIDATES.relevanceJudge, deps.decide, input)
    return output
  }

  const samples = deps.samples ?? 3
  const temperature = deps.temperature ?? 0.7

  // Fetch prompt
  const promptMeta = deps.fetchPrompt
    ? await deps.fetchPrompt('search-relevance-judge')
    : null
  const systemPrompt = promptMeta?.text ?? DEFAULT_SYSTEM_PROMPT

  // Build user message with product variables
  const descTrunc = (input.product.description_zh ?? '').slice(0, 600)
  const userMsg = [
    `Query: ${input.query}`,
    `name_zh: ${input.product.name_zh}`,
    input.product.name_en ? `name_en: ${input.product.name_en}` : null,
    input.product.category_zh ? `category_zh: ${input.product.category_zh}` : null,
    input.product.subcategory_zh ? `subcategory_zh: ${input.product.subcategory_zh}` : null,
    input.product.materials_zh ? `materials_zh: ${input.product.materials_zh}` : null,
    descTrunc ? `description_zh: ${descTrunc}` : null,
  ].filter(Boolean).join('\n')

  // Default chat uses createAuditedOpenAIClient
  const chatFn: ChatFn = deps.chat ?? (async (opts) => {
    const { createAuditedOpenAIClient } = await import('@/lib/services/llm-audit')
    const client = createAuditedOpenAIClient({ phase: 'search_relevance_judge' })
    const result = await client.chat({ ...opts, temperature })
    return { content: result.content ?? '' }
  })

  // The samples are independent, so run them concurrently; a rejected or
  // malformed sample is skipped. Votes keep sample order.
  const settled = await Promise.allSettled(
    Array.from({ length: samples }, async () =>
      chatFn({
        system: systemPrompt,
        user: userMsg,
        schema: JUDGE_JSON_SCHEMA,
      }),
    ),
  )
  const votes: number[] = []
  for (const outcome of settled) {
    if (outcome.status !== 'fulfilled') continue
    const parsed = parseAndValidate(outcome.value.content, JudgeOutputSchema)
    if (parsed.success) votes.push(parsed.data.grade)
  }

  if (votes.length === 0) {
    return { grade: null, votes: [], unanimous: false, split: false }
  }

  // Majority vote (mode); ties go to median
  const sorted = [...votes].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]!

  // Check for 3-way split (all different)
  const unique = new Set(votes)
  const isSplit = votes.length >= 3 && unique.size === votes.length

  // Majority: most common
  const counts = new Map<number, number>()
  for (const v of votes) counts.set(v, (counts.get(v) ?? 0) + 1)
  let maxCount = 0
  let majority = median
  for (const [v, c] of counts) {
    if (c > maxCount) { maxCount = c; majority = v }
  }

  const grade = isSplit ? median : majority
  const unanimous = unique.size === 1

  return { grade, votes, unanimous, split: isSplit }
}
