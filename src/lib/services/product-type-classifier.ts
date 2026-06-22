import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'

export type ClassificationResult = { productType: string; confidence: 'high' | 'medium' | 'low' }
export type BatchClassificationItem = { slug: string; name: string; description: string | null }
export type TriageBatchItem = { slug: string; name: string; description: string | null; website: string | null }
export type TriageResult = {
  isNonBrand: boolean
  nonBrandReason: string | null
  slug: string
  productType: string | null
  valueTags: string[]
  confidence: 'high' | 'medium' | 'low'
}

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions'
const DEEPSEEK_MODEL = 'deepseek-chat'
const CLASSIFY_TIMEOUT_MS = 30_000
const BATCH_CLASSIFY_TIMEOUT_MS = 60_000
export const VALID_PRODUCT_TYPES = new Set<string>(PRODUCT_TYPE_CATEGORIES.map(category => category.slug))

const SYSTEM_PROMPT = `你是台灣品牌分類專家。請根據品牌名稱和描述，將品牌分類到最適合的產品類別。

類別定義：
- fashion: 服飾、鞋履、上衣、褲子、洋裝等穿戴服裝
- bags-accessories: 包袋、皮件、帽子、圍巾、配件
- jewelry: 飾品、珠寶、耳環、項鍊、戒指、手鍊
- beauty: 美妝、保養、清潔、沐浴、香氛、蠟燭
- home: 居家用品、餐具、陶瓷、家具、廚具、園藝
- food-drink: 食品、飲料、茶、咖啡、農產品
- crafts: 手作工藝、文具、文創、藝術、插畫、皮革工藝
- tech: 3C科技、電子產品、手機配件
- outdoor: 戶外運動、健身、瑜珈、登山露營
- kids-pets: 兒童、嬰兒、玩具、寵物用品

規則：
- 選擇最符合品牌「核心產品」的類別
- 如果品牌跨多個類別，選擇主要產品線所屬類別
- 回傳 JSON 格式，不要加任何其他文字`

const TRIAGE_SYSTEM_PROMPT = `${SYSTEM_PROMPT}

請同時判斷輸入是否不是實際品牌（例如代購、選物店、平台、媒體、活動、代理商、通路或其他非品牌實體）。
每個品牌請回傳 isNonBrand、nonBrandReason、slug_generated、productType、confidence。`

type DeepSeekResponse = {
  choices?: Array<{ message?: { content?: string } }>
}

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
  const productType = entry.productType
  const confidence = entry.confidence
  const valueTags = entry.valueTags

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
    productType,
    valueTags: Array.isArray(valueTags) ? valueTags.filter((tag): tag is string => typeof tag === 'string') : [],
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

  const userContent = `品牌名稱：${brandName}\n描述：${description ?? '無'}\n回傳格式：{"productType":"...","confidence":"high|medium|low"}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CLASSIFY_TIMEOUT_MS)

  try {
    const res = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        max_tokens: 100,
        temperature: 0.1,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      console.error(`  → product type classification failed: HTTP ${res.status}`)
      return null
    }

    const data = await res.json() as DeepSeekResponse

    const content = data.choices?.[0]?.message?.content?.trim()
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
  } finally {
    clearTimeout(timeout)
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
  const userContent = `請將以下品牌分類，回傳 JSON 陣列：\n${list}\n回傳格式：[{"slug":"...","productType":"...","confidence":"high|medium|low"}]`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), BATCH_CLASSIFY_TIMEOUT_MS)

  try {
    const res = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        max_tokens: 1500,
        temperature: 0.1,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      console.error(`  → product type batch classification failed: HTTP ${res.status}`)
      return null
    }

    const data = await res.json() as DeepSeekResponse

    const content = data.choices?.[0]?.message?.content?.trim()
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
  } finally {
    clearTimeout(timeout)
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

  const userContent = `品牌 slug：${brand.slug}\n品牌名稱：${brand.name}\n描述：${brand.description ?? '無'}\n網站：${brand.website ?? '無'}\n回傳格式：{"isNonBrand":true|false,"nonBrandReason":"...或 null","slug_generated":"...","productType":"...或 null","confidence":"high|medium|low"}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CLASSIFY_TIMEOUT_MS)

  try {
    const res = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: TRIAGE_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        max_tokens: 200,
        temperature: 0.1,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      console.error(`  → brand triage failed: HTTP ${res.status}`)
      return null
    }

    const data = await res.json() as DeepSeekResponse

    const content = data.choices?.[0]?.message?.content?.trim()
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
  } finally {
    clearTimeout(timeout)
  }
}

async function triageBrandsBatchChunk(
  brands: TriageBatchItem[]
): Promise<Map<string, TriageResult> | null> {
  const token = process.env.DEEPSEEK_API_KEY
  if (!token) return null

  const list = brands.map((brand, index) => {
    return `${index + 1}. [${brand.slug}] 品牌名：${brand.name} / 描述：${brand.description ?? '無'} / 網站：${brand.website ?? '無'}`
  }).join('\n')
  const userContent = `請判斷以下項目是否為實際品牌，並為實際品牌分類，回傳 JSON 陣列：\n${list}\n回傳格式：[{"slug":"...","isNonBrand":true|false,"nonBrandReason":"...或 null","slug_generated":"...","productType":"...或 null","confidence":"high|medium|low"}]`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), BATCH_CLASSIFY_TIMEOUT_MS)

  try {
    const res = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: TRIAGE_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        max_tokens: 2500,
        temperature: 0.1,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      console.error(`  → brand triage batch failed: HTTP ${res.status}`)
      return null
    }

    const data = await res.json() as DeepSeekResponse

    const content = data.choices?.[0]?.message?.content?.trim()
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
  } finally {
    clearTimeout(timeout)
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
