import { EXPANSION_SYSTEM_PROMPT } from '@/lib/prompts'
import { createDeepSeekClient } from '@/lib/services/deepseek-client'
import type { ReputationSummary } from '@/lib/types/brand'

const DEEPSEEK_TIMEOUT_MS = 60_000

export type ExpansionResult = {
  reputationSummary: ReputationSummary | null
}

type ExpansionInput = {
  name: string
  description: string | null
  category?: string | null
  serpSnippets: string[]
  siteContent: string | null
}

type RawProvenanceSource = {
  url?: unknown
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function parseSources(value: unknown): { url: string }[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const source = item as RawProvenanceSource
    if (!isString(source.url)) return []
    return [{ url: source.url }]
  })
}

function parseReputationSummary(value: unknown): ReputationSummary | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  if (!isString(item.text) || item.text.trim().length === 0) return null
  const sources = parseSources(item.sources)
  if (sources.length === 0) return null
  return {
    text: item.text.trim(),
    textEn: isString(item.text_en) ? item.text_en.trim() : null,
    sources,
  }
}

function parseExpansionResult(content: string): ExpansionResult | null {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>
    return {
      reputationSummary: parseReputationSummary(parsed.reputation_summary),
    }
  } catch {
    return null
  }
}

export async function runExpansionResearch(
  input: ExpansionInput,
): Promise<ExpansionResult | null> {
  const token = process.env.DEEPSEEK_API_KEY
  if (!token) return null
  if (
    input.serpSnippets.length === 0 &&
    !input.siteContent &&
    !input.description
  )
    return null

  const userContent = [
    `品牌名稱：${input.name}`,
    input.category ? `類別：${input.category}` : '',
    input.description ? `品牌描述：${input.description}` : '',
    input.serpSnippets.length > 0
      ? `搜尋摘要：\n${input.serpSnippets.slice(0, 5).join('\n')}`
      : '',
    input.siteContent ? `網站內容：\n${input.siteContent}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const client = createDeepSeekClient({ apiKey: token })

  try {
    const { response, content } = await client.chat({
      system: EXPANSION_SYSTEM_PROMPT,
      user: userContent,
      json: true,
      timeoutMs: DEEPSEEK_TIMEOUT_MS,
      maxTokens: 1200,
      temperature: 0.1,
    })

    if (!response.ok) return null

    if (!content) return null
    return parseExpansionResult(content)
  } catch {
    return null
  }
}
