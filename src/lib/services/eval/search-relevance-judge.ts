import { z } from 'zod'
import type { PromptMeta } from '@/lib/langfuse/prompt'
import { RELEVANCE_GRADE_LEVELS } from '@/lib/prompts/shared'
import { describeError } from '@/lib/errors'
import type { OpenAIJsonSchema } from '@/lib/services/openai-client'
import {
  parseAndValidate,
  toStrictJsonSchema,
} from '@/lib/services/_shared/zod-schema'
import { JEV_CANDIDATES, runJevCandidate, type DecideFn } from './jev-questions'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JudgeProduct = {
  name_zh: string
  name_en?: string | null
  brand_name?: string | null
  category_zh?: string | null
  subcategory_zh?: string | null
  materials_zh?: string | null
  description_zh?: string | null
}

export type JudgeResult = {
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

const BatchOutputSchema = z.object({
  grades: z.array(z.object({ id: z.string(), grade: z.number().int().min(0).max(3) })),
})

const BATCH_JSON_SCHEMA = {
  name: 'relevance_grades',
  schema: toStrictJsonSchema(BatchOutputSchema),
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

function systemPromptFor(prompt: string | undefined, queryType?: string): string {
  return (prompt ?? DEFAULT_SYSTEM_PROMPT) + (queryType === 'brand_name'
    ? '\nFor a brand name query, products from the named brand are a direct match (grade 3); products from other brands are not a match (grade 0).'
    : '')
}

function gradeVotes(votes: number[]): JudgeResult {
  if (votes.length === 0) return { grade: null, votes: [], unanimous: false, split: false }
  const sorted = [...votes].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]!
  const unique = new Set(votes)
  const split = votes.length >= 3 && unique.size === votes.length
  const counts = new Map<number, number>()
  for (const vote of votes) counts.set(vote, (counts.get(vote) ?? 0) + 1)
  let maxCount = 0
  let majority = median
  for (const [vote, count] of counts) {
    if (count > maxCount) { maxCount = count; majority = vote }
  }
  return { grade: split ? median : majority, votes, unanimous: unique.size === 1, split }
}

export async function judgeRelevanceBatch(
  input: { query: string; queryType?: string; products: Array<{ id: string; product: JudgeProduct }> },
  deps: Pick<JudgeDeps, 'chat' | 'fetchPrompt' | 'samples' | 'temperature'> = {},
): Promise<Map<string, JudgeResult>> {
  const samples = deps.samples ?? 3
  const promptMeta = deps.fetchPrompt ? await deps.fetchPrompt('search-relevance-judge') : null
  const system = `${systemPromptFor(promptMeta?.text, input.queryType)}\nGrade each product independently. Return one grade for every id; do not compare products or infer relevance from list order.`
  const user = JSON.stringify({
    query: input.query,
    products: input.products.map(({ id, product }) => ({
      id,
      ...product,
      description_zh: product.description_zh?.slice(0, 600),
    })),
  })
  const chatFn: ChatFn = deps.chat ?? (async (opts) => {
    const { createAuditedOpenAIClient } = await import('@/lib/services/llm-audit')
    const client = createAuditedOpenAIClient({ phase: 'search_relevance_judge' })
    const result = await client.chat({ ...opts, temperature: deps.temperature ?? 0.7 })
    return { content: result.content ?? '' }
  })
  const settled = await Promise.allSettled(Array.from({ length: samples }, () =>
    chatFn({ system, user, schema: BATCH_JSON_SCHEMA }),
  ))
  const knownIds = new Set(input.products.map(item => item.id))
  const votes = new Map(input.products.map(item => [item.id, [] as number[]]))
  for (const outcome of settled) {
    if (outcome.status !== 'fulfilled') continue
    const parsed = parseAndValidate(outcome.value.content, BatchOutputSchema)
    if (!parsed.success) continue
    const seen = new Set<string>()
    for (const item of parsed.data.grades) {
      if (!knownIds.has(item.id) || seen.has(item.id)) continue
      seen.add(item.id)
      votes.get(item.id)!.push(item.grade)
    }
  }
  return new Map([...votes].map(([id, itemVotes]) => [id,
    itemVotes.length === samples ? gradeVotes(itemVotes) : gradeVotes([]),
  ]))
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

export async function judgeRelevance(
  input: { query: string; queryType?: string; product: JudgeProduct },
  deps: JudgeDeps = {},
): Promise<JudgeResult> {
  if (deps.decide) {
    try {
      const { output } = await runJevCandidate(JEV_CANDIDATES.relevanceJudge, deps.decide, input)
      return output
    } catch (error) {
      // Same degraded result as the chat path when every sample fails, so one
      // failed call cannot abort a judge run.
      console.warn(`[search-relevance-judge] Jev decide failed: ${describeError(error)}`)
      return { grade: null, votes: [], unanimous: false, split: false }
    }
  }

  const samples = deps.samples ?? 3
  const temperature = deps.temperature ?? 0.7

  // Fetch prompt
  const promptMeta = deps.fetchPrompt
    ? await deps.fetchPrompt('search-relevance-judge')
    : null
  const systemPrompt = systemPromptFor(promptMeta?.text, input.queryType)

  // Build user message with product variables
  const descTrunc = (input.product.description_zh ?? '').slice(0, 600)
  const userMsg = [
    `Query: ${input.query}`,
    `name_zh: ${input.product.name_zh}`,
    input.product.name_en ? `name_en: ${input.product.name_en}` : null,
    input.product.brand_name ? `brand_name: ${input.product.brand_name}` : null,
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

  return gradeVotes(votes)
}
