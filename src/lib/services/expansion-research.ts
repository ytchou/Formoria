import { EXPANSION_SYSTEM_PROMPT } from '@/lib/prompts'
import { createDeepSeekClient } from '@/lib/services/deepseek-client'
import type { Certification, Manufacturing, Policies, ReputationSummary } from '@/lib/types/brand'

const DEEPSEEK_TIMEOUT_MS = 60_000

export type ExpansionResult = {
  reputationSummary: ReputationSummary | null
  manufacturing: Manufacturing | null
  certifications: Certification[] | null
  policies: Policies | null
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
  title?: unknown
  retrievedAt?: unknown
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function parseSources(value: unknown): { url: string; title: string; retrievedAt: string }[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const source = item as RawProvenanceSource
    if (!isString(source.url) || !isString(source.title) || !isString(source.retrievedAt)) return []
    return [{ url: source.url, title: source.title, retrievedAt: source.retrievedAt }]
  })
}

function parseReputationSummary(value: unknown): ReputationSummary | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  if (!isString(item.text) || item.text.trim().length === 0) return null
  const sources = parseSources(item.sources)
  if (sources.length === 0 || !isString(item.retrievedAt)) return null
  return {
    text: item.text.trim(),
    sources,
    retrievedAt: item.retrievedAt,
  }
}

function parseManufacturing(value: unknown): Manufacturing | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  const productionModel = item.productionModel
  const normalizedProductionModel = productionModel === 'own' || productionModel === 'oem' || productionModel === 'mixed'
    ? productionModel
    : null
  const sources = parseSources(item.sources)

  return {
    factoryLocation: isString(item.factoryLocation) ? item.factoryLocation : null,
    productionModel: normalizedProductionModel,
    notes: isString(item.notes) ? item.notes : null,
    sources,
  }
}

function parseCertifications(value: unknown): Certification[] | null {
  if (!Array.isArray(value)) return null
  const certifications = value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const cert = item as Record<string, unknown>
    if (!isString(cert.name) || cert.name.trim().length === 0) return []
    const source = cert.source && typeof cert.source === 'object'
      ? (cert.source as RawProvenanceSource)
      : null
    const parsedSource = source && isString(source.url) && isString(source.title) && isString(source.retrievedAt)
      ? { url: source.url, title: source.title, retrievedAt: source.retrievedAt }
      : null

    return [{
      name: cert.name.trim(),
      issuer: isString(cert.issuer) ? cert.issuer : null,
      year: typeof cert.year === 'number' && Number.isInteger(cert.year) ? cert.year : null,
      source: parsedSource,
    }]
  })
  return certifications.length > 0 ? certifications : []
}

function parsePolicies(value: unknown): Policies | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  const sources = parseSources(item.sources)
  if (sources.length === 0) return null

  return {
    returns: isString(item.returns) ? item.returns : null,
    warranty: isString(item.warranty) ? item.warranty : null,
    shipsInternational: typeof item.shipsInternational === 'boolean' ? item.shipsInternational : null,
    sources,
  }
}

function parseExpansionResult(content: string): ExpansionResult | null {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>
    return {
      reputationSummary: parseReputationSummary(parsed.reputation_summary),
      manufacturing: parseManufacturing(parsed.manufacturing),
      certifications: parseCertifications(parsed.certifications),
      policies: parsePolicies(parsed.policies),
    }
  } catch {
    return null
  }
}

export async function runExpansionResearch(input: ExpansionInput): Promise<ExpansionResult | null> {
  const token = process.env.DEEPSEEK_API_KEY
  if (!token) return null
  if (input.serpSnippets.length === 0 && !input.siteContent && !input.description) return null

  const userContent = [
    `品牌名稱：${input.name}`,
    input.category ? `類別：${input.category}` : '',
    input.description ? `品牌描述：${input.description}` : '',
    input.serpSnippets.length > 0 ? `搜尋摘要：\n${input.serpSnippets.slice(0, 5).join('\n')}` : '',
    input.siteContent ? `網站內容：\n${input.siteContent}` : '',
  ].filter(Boolean).join('\n\n')

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
