import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'

export type ClassificationResult = { productType: string; confidence: 'high' | 'medium' | 'low' }
export type BatchClassificationItem = { slug: string; name: string; description: string | null }

export const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions'
export const DEEPSEEK_MODEL = 'deepseek-chat'
export const CLASSIFY_TIMEOUT_MS = 30_000
export const BATCH_CLASSIFY_TIMEOUT_MS = 60_000
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

export async function classifyProductType(
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
