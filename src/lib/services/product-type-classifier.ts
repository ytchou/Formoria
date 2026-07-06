import { CLASSIFY_SYSTEM_PROMPT, EXTRACTION_SYSTEM_PROMPT, TRIAGE_SYSTEM_PROMPT } from '@/lib/prompts'
import { createDeepSeekClient } from '@/lib/services/deepseek-client'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'

export type ClassificationResult = { productType: string; confidence: 'high' | 'medium' | 'low' }
export type BatchClassificationItem = { slug: string; name: string; description: string | null }
export type TriageBatchItem = { slug: string; name: string; description: string | null; website: string | null; snippets?: string[] }
export type TriageResult = {
  isNonBrand: boolean
  nonBrandReason: string | null
  slug: string
  slugGenerated: string | null
  productType: string | null
  confidence: 'high' | 'medium' | 'low'
}
export type ExtractionResult = {
  priceRange: 1 | 2 | 3 | null
  productTags: string[]
  city: string | null
  foundingYear: number | null
  signatureProducts: string[]
  whereToBuy: string | null
  categoryMismatch: boolean
}
export type ExtractionInput = {
  brandName: string
  description: string | null
  snippets: string[]
  siteContent?: string | null
}

const CLASSIFY_TIMEOUT_MS = 30_000
const BATCH_CLASSIFY_TIMEOUT_MS = 60_000
const VALID_PRODUCT_TYPES = new Set<string>(PRODUCT_TYPE_CATEGORIES.map(category => category.slug))


type UnknownRecord = Record<string, unknown>

function isConfidence(value: unknown): value is ClassificationResult['confidence'] {
  return value === 'high' || value === 'medium' || value === 'low'
}

function parseClassification(content: string): ClassificationResult | null {
  const parsed = JSON.parse(content) as UnknownRecord
  const productType = parsed.productType
  const confidence = parsed.confidence

  if (typeof productType !== 'string' || !VALID_PRODUCT_TYPES.has(productType) || !isConfidence(confidence)) {
    return null
  }

  return { productType, confidence }
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean))]
}

function parseNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export function parseExtractionResult(content: string): ExtractionResult {
  try {
    const parsed = JSON.parse(content) as UnknownRecord
    const priceRange = parsed.price_range === 1 || parsed.price_range === 2 || parsed.price_range === 3
      ? parsed.price_range
      : null
    const foundingYear = typeof parsed.founding_year === 'number' && Number.isInteger(parsed.founding_year)
      ? parsed.founding_year
      : null

    return {
      priceRange,
      productTags: parseStringArray(parsed.product_tags).slice(0, 5),
      city: parseNullableString(parsed.city),
      foundingYear,
      signatureProducts: parseStringArray(parsed.signature_products).slice(0, 10),
      whereToBuy: parseNullableString(parsed.where_to_buy),
      categoryMismatch: parsed.category_mismatch === true,
    }
  } catch {
    return {
      priceRange: null,
      productTags: [],
      city: null,
      foundingYear: null,
      signatureProducts: [],
      whereToBuy: null,
      categoryMismatch: false,
    }
  }
}

export async function extractBrandFacts(input: ExtractionInput): Promise<ExtractionResult | null> {
  const token = process.env.DEEPSEEK_API_KEY
  if (!token) return null
  if (!input.description && input.snippets.length === 0 && !input.siteContent) return null

  const userContent = [
    `品牌名稱：${input.brandName}`,
    input.description ? `描述：${input.description}` : '',
    input.snippets.length > 0 ? `搜尋摘要：\n${input.snippets.slice(0, 5).join('\n')}` : '',
    input.siteContent ? `網站內容：\n${input.siteContent}` : '',
  ].filter(Boolean).join('\n\n')

  const client = createDeepSeekClient({ apiKey: token })

  try {
    const { response, data, content } = await client.chat({
      system: EXTRACTION_SYSTEM_PROMPT,
      user: userContent,
      json: true,
      timeoutMs: CLASSIFY_TIMEOUT_MS,
      maxTokens: 600,
      temperature: 0,
    })

    if (!response.ok) {
      console.error(`  → fact extraction failed: HTTP ${response.status}`)
      return null
    }

    if (!content) {
      console.error(`  → fact extraction: empty response, data=${JSON.stringify(data).slice(0, 200)}`)
      return null
    }

    return parseExtractionResult(content)
  } catch (err) {
    console.error(`  → fact extraction failed: ${err instanceof Error ? err.message : err}`)
    return null
  }
}

function parseBatchClassification(content: string, validSlugs: Set<string>): Map<string, ClassificationResult> | null {
  const parsed = JSON.parse(content) as unknown

  if (!Array.isArray(parsed)) {
    return null
  }

  const results = new Map<string, ClassificationResult>()

  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue

    const item = entry as UnknownRecord
    const slug = item.slug
    const productType = item.productType
    const confidence = item.confidence

    if (
      typeof slug !== 'string' ||
      !validSlugs.has(slug) ||
      typeof productType !== 'string' ||
      !VALID_PRODUCT_TYPES.has(productType) ||
      !isConfidence(confidence)
    ) {
      continue
    }

    results.set(slug, { productType, confidence })
  }

  return results
}

function parseTriageEntry(entry: UnknownRecord, slug: string): TriageResult | null {
  const isNonBrand = entry.isNonBrand
  const nonBrandReason = entry.nonBrandReason
  const slugGenerated = entry.slug_generated
  const productType = entry.productType
  const confidence = entry.confidence

  if (typeof isNonBrand !== 'boolean' || !isConfidence(confidence)) {
    return null
  }

  if (productType !== null && (typeof productType !== 'string' || !VALID_PRODUCT_TYPES.has(productType))) {
    return null
  }

  return {
    isNonBrand,
    nonBrandReason: typeof nonBrandReason === 'string' ? nonBrandReason : null,
    slug,
    slugGenerated: typeof slugGenerated === 'string' ? slugGenerated : null,
    productType,
    confidence,
  }
}

function parseTriageResponse(content: string, brands: TriageBatchItem[]): Map<string, TriageResult> | null {
  const parsed = JSON.parse(content) as unknown

  if (!Array.isArray(parsed)) {
    return null
  }

  const validSlugs = new Set(brands.map(brand => brand.slug))
  const results = new Map<string, TriageResult>()

  parsed.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return

    const item = entry as UnknownRecord
    const responseSlug = item.slug
    const slug = typeof responseSlug === 'string' && validSlugs.has(responseSlug)
      ? responseSlug
      : brands[index]?.slug

    if (!slug) return

    const result = parseTriageEntry(item, slug)
    if (result) {
      results.set(slug, result)
    }
  })

  return results
}

function parseSingleTriageResponse(content: string, slug: string): TriageResult | null {
  const parsed = JSON.parse(content) as unknown

  if (!parsed || typeof parsed !== 'object') {
    return null
  }

  return parseTriageEntry(parsed as UnknownRecord, slug)
}

async function classifyProductType(
  brandName: string,
  description: string | null
): Promise<ClassificationResult | null> {
  const token = process.env.DEEPSEEK_API_KEY
  if (!token) return null

  const userContent = `品牌名稱：${brandName}\n描述：${description ?? '無'}`

  const client = createDeepSeekClient({ apiKey: token })

  try {
    const { response, data, content } = await client.chat({
      system: CLASSIFY_SYSTEM_PROMPT,
      user: userContent,
      json: true,
      timeoutMs: CLASSIFY_TIMEOUT_MS,
      maxTokens: 100,
      temperature: 0,
    })

    if (!response.ok) {
      console.error(`  → product type classification failed: HTTP ${response.status}`)
      return null
    }

    if (!content) {
      console.error(`  → product type classification: empty response, data=${JSON.stringify(data).slice(0, 200)}`)
      return null
    }

    const result = parseClassification(content)
    if (!result) {
      console.error(`  → product type classification: invalid response: ${content.slice(0, 200)}`)
      return null
    }

    return result
  } catch (err) {
    console.error(`  → product type classification failed: ${err instanceof Error ? err.message : err}`)
    return null
  }
}

async function classifyProductTypeBatchChunk(
  brands: BatchClassificationItem[]
): Promise<Map<string, ClassificationResult> | null> {
  const token = process.env.DEEPSEEK_API_KEY
  if (!token) return null

  const validSlugs = new Set(brands.map(brand => brand.slug))
  const list = brands.map((brand, index) => {
    return `${index + 1}. [${brand.slug}] 品牌名：${brand.name} / 描述：${brand.description ?? '無'}`
  }).join('\n')
  const userContent = `請將以下品牌分類：\n${list}`

  const client = createDeepSeekClient({ apiKey: token })

  try {
    const { response, data, content } = await client.chat({
      system: CLASSIFY_SYSTEM_PROMPT,
      user: userContent,
      json: true,
      timeoutMs: BATCH_CLASSIFY_TIMEOUT_MS,
      maxTokens: 1500,
      temperature: 0,
    })

    if (!response.ok) {
      console.error(`  → product type batch classification failed: HTTP ${response.status}`)
      return null
    }

    if (!content) {
      console.error(`  → product type batch classification: empty response, data=${JSON.stringify(data).slice(0, 200)}`)
      return null
    }

    const results = parseBatchClassification(content, validSlugs)
    if (!results) {
      console.error(`  → product type batch classification: invalid response: ${content.slice(0, 200)}`)
      return null
    }

    return results
  } catch (err) {
    console.error(`  → product type batch classification failed: ${err instanceof Error ? err.message : err}`)
    return null
  }
}

export async function classifyProductTypeBatch(
  brands: BatchClassificationItem[]
): Promise<Map<string, ClassificationResult>> {
  const results = new Map<string, ClassificationResult>()

  for (let i = 0; i < brands.length; i += 20) {
    const batch = brands.slice(i, i + 20)
    const batchResults = await classifyProductTypeBatchChunk(batch)

    if (batchResults) {
      for (const [slug, result] of batchResults) {
        results.set(slug, result)
      }
      continue
    }

    for (const brand of batch) {
      const result = await classifyProductType(brand.name, brand.description)
      if (result) {
        results.set(brand.slug, result)
      }
    }
  }

  return results
}

async function triageBrand(brand: TriageBatchItem): Promise<TriageResult | null> {
  const token = process.env.DEEPSEEK_API_KEY
  if (!token) return null

  const snippetLine = brand.snippets?.length ? `\n搜尋摘要：${brand.snippets.slice(0, 3).join('；')}` : ''
  const userContent = `品牌 slug：${brand.slug}\n品牌名稱：${brand.name}\n描述：${brand.description ?? '無'}\n網站：${brand.website ?? '無'}${snippetLine}`

  const client = createDeepSeekClient({ apiKey: token })

  try {
    const { response, data, content } = await client.chat({
      system: TRIAGE_SYSTEM_PROMPT,
      user: userContent,
      json: true,
      timeoutMs: CLASSIFY_TIMEOUT_MS,
      maxTokens: 500,
      temperature: 0,
    })

    if (!response.ok) {
      console.error(`  → brand triage failed: HTTP ${response.status}`)
      return null
    }

    if (!content) {
      console.error(`  → brand triage: empty response, data=${JSON.stringify(data).slice(0, 200)}`)
      return null
    }

    const result = parseSingleTriageResponse(content, brand.slug)
    if (!result) {
      console.error(`  → brand triage: invalid response: ${content.slice(0, 200)}`)
      return null
    }

    return result
  } catch (err) {
    console.error(`  → brand triage failed: ${err instanceof Error ? err.message : err}`)
    return null
  }
}

async function triageBrandsBatchChunk(
  brands: TriageBatchItem[]
): Promise<Map<string, TriageResult> | null> {
  const token = process.env.DEEPSEEK_API_KEY
  if (!token) return null

  const list = brands.map((brand, index) => {
    const base = `${index + 1}. [${brand.slug}] 品牌名：${brand.name} / 描述：${brand.description ?? '無'} / 網站：${brand.website ?? '無'}`
    const snippetStr = brand.snippets?.length ? ` / 搜尋摘要：${brand.snippets.slice(0, 3).join('；')}` : ''
    return base + snippetStr
  }).join('\n')
  const userContent = `請判斷以下項目是否為實際品牌，並為實際品牌分類：\n${list}`

  const client = createDeepSeekClient({ apiKey: token })

  try {
    const { response, data, content } = await client.chat({
      system: TRIAGE_SYSTEM_PROMPT,
      user: userContent,
      json: true,
      timeoutMs: BATCH_CLASSIFY_TIMEOUT_MS,
      maxTokens: 4000,
      temperature: 0,
    })

    if (!response.ok) {
      console.error(`  → brand triage batch failed: HTTP ${response.status}`)
      return null
    }

    if (!content) {
      console.error(`  → brand triage batch: empty response, data=${JSON.stringify(data).slice(0, 200)}`)
      return null
    }

    const results = parseTriageResponse(content, brands)
    if (!results) {
      console.error(`  → brand triage batch: invalid response: ${content.slice(0, 200)}`)
      return null
    }

    return results
  } catch (err) {
    console.error(`  → brand triage batch failed: ${err instanceof Error ? err.message : err}`)
    return null
  }
}

export async function triageBrandsBatch(
  brands: TriageBatchItem[]
): Promise<Map<string, TriageResult>> {
  const results = new Map<string, TriageResult>()

  for (let i = 0; i < brands.length; i += 20) {
    const batch = brands.slice(i, i + 20)
    const batchResults = await triageBrandsBatchChunk(batch)

    if (batchResults) {
      for (const [slug, result] of batchResults) {
        results.set(slug, result)
      }
      continue
    }

    for (const brand of batch) {
      const result = await triageBrand(brand)
      if (result) {
        results.set(brand.slug, result)
      }
    }
  }

  return results
}
