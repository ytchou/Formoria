import { CLASSIFY_SYSTEM_PROMPT, DETECT_SYSTEM_PROMPT } from '@/lib/prompts'
import { createDeepSeekClient } from '@/lib/services/deepseek-client'
import { createAuditedDeepSeekClient } from '@/lib/services/llm-audit'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'
import type { EnrichmentTarget } from './enrichment-target'

export type ClassificationResult = { productType: string; confidence: 'high' | 'medium' | 'low' }
export type BatchClassificationItem = {
  slug: string
  name: string
  description: string | null
  target?: EnrichmentTarget
}
export type DetectBatchItem = {
  slug: string
  name: string
  description: string | null
  website: string | null
  snippets?: string[]
  target?: EnrichmentTarget
}
export type DetectResult = {
  isNonBrand: boolean
  nonBrandReason: string | null
  brandName: string | null
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

const CLASSIFY_TIMEOUT_MS = 30_000
const BATCH_CLASSIFY_TIMEOUT_MS = 60_000
const VALID_PRODUCT_TYPES = new Set<string>(PRODUCT_TYPE_CATEGORIES.map(category => category.slug))


type UnknownRecord = Record<string, unknown>

function createClassifierClient(
  apiKey: string,
  phase: 'classification' | 'detect',
  target: EnrichmentTarget | undefined,
  jobId?: string,
) {
  if (!target) return createDeepSeekClient({ apiKey })

  return createAuditedDeepSeekClient(
    {
      target,
      phase,
      ...(jobId ? { jobId } : {}),
    },
    { apiKey },
  )
}

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

const VALID_CITY_SLUGS = new Set([
  'taipei', 'new_taipei', 'taoyuan', 'taichung', 'tainan', 'kaohsiung',
  'keelung', 'hsinchu_city', 'chiayi_city',
  'hsinchu_county', 'miaoli', 'changhua', 'nantou', 'yunlin',
  'chiayi_county', 'pingtung', 'yilan', 'hualien', 'taitung',
  'penghu', 'kinmen', 'lienchiang',
])

const CITY_NAME_TO_SLUG: Record<string, string> = {
  '台北': 'taipei', '台北市': 'taipei', 'taipei city': 'taipei',
  '新北': 'new_taipei', '新北市': 'new_taipei', 'new taipei': 'new_taipei',
  '桃園': 'taoyuan', '桃園市': 'taoyuan',
  '台中': 'taichung', '台中市': 'taichung',
  '台南': 'tainan', '台南市': 'tainan',
  '高雄': 'kaohsiung', '高雄市': 'kaohsiung',
  '基隆': 'keelung', '基隆市': 'keelung',
  '新竹市': 'hsinchu_city', 'hsinchu city': 'hsinchu_city',
  '嘉義市': 'chiayi_city', 'chiayi city': 'chiayi_city',
  '新竹縣': 'hsinchu_county', 'hsinchu county': 'hsinchu_county',
  '苗栗': 'miaoli', '苗栗縣': 'miaoli',
  '彰化': 'changhua', '彰化縣': 'changhua',
  '南投': 'nantou', '南投縣': 'nantou',
  '雲林': 'yunlin', '雲林縣': 'yunlin',
  '嘉義縣': 'chiayi_county', 'chiayi county': 'chiayi_county',
  '屏東': 'pingtung', '屏東縣': 'pingtung',
  '宜蘭': 'yilan', '宜蘭縣': 'yilan',
  '花蓮': 'hualien', '花蓮縣': 'hualien',
  '台東': 'taitung', '台東縣': 'taitung',
  '澎湖': 'penghu', '澎湖縣': 'penghu',
  '金門': 'kinmen', '金門縣': 'kinmen',
  '連江': 'lienchiang', '連江縣': 'lienchiang', '馬祖': 'lienchiang',
}

function mapCityToSlug(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (VALID_CITY_SLUGS.has(trimmed)) return trimmed
  const mapped = CITY_NAME_TO_SLUG[trimmed] ?? CITY_NAME_TO_SLUG[trimmed.toLowerCase()]
  return mapped ?? null
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
      city: mapCityToSlug(parseNullableString(parsed.city)),
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

function parseTriageEntry(entry: UnknownRecord, slug: string): DetectResult | null {
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

  const brandName = entry.brand_name

  return {
    isNonBrand,
    nonBrandReason: typeof nonBrandReason === 'string' ? nonBrandReason : null,
    brandName: typeof brandName === 'string' && brandName.trim().length > 0 ? brandName.trim() : null,
    slug,
    slugGenerated: typeof slugGenerated === 'string' ? slugGenerated : null,
    productType,
    confidence,
  }
}

function parseTriageResponse(content: string, brands: DetectBatchItem[]): Map<string, DetectResult> | null {
  const parsed = JSON.parse(content) as unknown

  if (!Array.isArray(parsed)) {
    return null
  }

  const validSlugs = new Set(brands.map(brand => brand.slug))
  const results = new Map<string, DetectResult>()

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

function parseSingleTriageResponse(content: string, slug: string): DetectResult | null {
  const parsed = JSON.parse(content) as unknown

  if (!parsed || typeof parsed !== 'object') {
    return null
  }

  return parseTriageEntry(parsed as UnknownRecord, slug)
}

async function classifyProductType(
  brand: BatchClassificationItem,
  jobId?: string,
): Promise<ClassificationResult | null> {
  const token = process.env.DEEPSEEK_API_KEY
  if (!token) return null

  const userContent = `品牌名稱：${brand.name}\n描述：${brand.description ?? '無'}`

  const client = createClassifierClient(token, 'classification', brand.target, jobId)

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
  brands: BatchClassificationItem[],
  jobId?: string,
): Promise<Map<string, ClassificationResult> | null> {
  const token = process.env.DEEPSEEK_API_KEY
  if (!token) return null

  const validSlugs = new Set(brands.map(brand => brand.slug))
  const list = brands.map((brand, index) => {
    return `${index + 1}. [${brand.slug}] 品牌名：${brand.name} / 描述：${brand.description ?? '無'}`
  }).join('\n')
  const userContent = `請將以下品牌分類：\n${list}`

  const client = createClassifierClient(token, 'classification', brands.at(0)?.target, jobId)

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
  brands: BatchClassificationItem[],
  jobId?: string,
): Promise<Map<string, ClassificationResult>> {
  const results = new Map<string, ClassificationResult>()

  for (let i = 0; i < brands.length; i += 20) {
    const batch = brands.slice(i, i + 20)
    const batchResults = await classifyProductTypeBatchChunk(batch, jobId)

    if (batchResults) {
      for (const [slug, result] of batchResults) {
        results.set(slug, result)
      }
      continue
    }

    for (const brand of batch) {
      const result = await classifyProductType(brand, jobId)
      if (result) {
        results.set(brand.slug, result)
      }
    }
  }

  return results
}

async function detectBrand(brand: DetectBatchItem, jobId?: string): Promise<DetectResult | null> {
  const token = process.env.DEEPSEEK_API_KEY
  if (!token) return null

  const snippetLine = brand.snippets?.length ? `\n搜尋摘要：${brand.snippets.slice(0, 10).join('；')}` : ''
  const userContent = `品牌 slug：${brand.slug}\n品牌名稱：${brand.name}\n描述：${brand.description ?? '無'}\n網站：${brand.website ?? '無'}${snippetLine}`

  const client = createClassifierClient(token, 'detect', brand.target, jobId)

  try {
    const { response, data, content } = await client.chat({
      system: DETECT_SYSTEM_PROMPT,
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

async function detectBrandsBatchChunk(
  brands: DetectBatchItem[],
  jobId?: string,
): Promise<Map<string, DetectResult> | null> {
  const token = process.env.DEEPSEEK_API_KEY
  if (!token) return null

  const list = brands.map((brand, index) => {
    const base = `${index + 1}. [${brand.slug}] 品牌名：${brand.name} / 描述：${brand.description ?? '無'} / 網站：${brand.website ?? '無'}`
    const snippetStr = brand.snippets?.length ? ` / 搜尋摘要：${brand.snippets.slice(0, 10).join('；')}` : ''
    return base + snippetStr
  }).join('\n')
  const userContent = `請判斷以下項目是否為實際品牌，並為實際品牌分類：\n${list}`

  const client = createClassifierClient(token, 'detect', brands.at(0)?.target, jobId)

  try {
    const { response, data, content } = await client.chat({
      system: DETECT_SYSTEM_PROMPT,
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

export async function detectBrandsBatch(
  brands: DetectBatchItem[],
  jobId?: string,
): Promise<Map<string, DetectResult>> {
  const results = new Map<string, DetectResult>()

  for (let i = 0; i < brands.length; i += 20) {
    const batch = brands.slice(i, i + 20)
    const batchResults = await detectBrandsBatchChunk(batch, jobId)

    if (batchResults) {
      for (const [slug, result] of batchResults) {
        results.set(slug, result)
      }
      continue
    }

    for (const brand of batch) {
      const result = await detectBrand(brand, jobId)
      if (result) {
        results.set(brand.slug, result)
      }
    }
  }

  return results
}
