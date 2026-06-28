import { DESCRIPTION_AND_CLASSIFY_SYSTEM_PROMPT, DESCRIPTION_SYSTEM_PROMPT } from '@/lib/prompts'
import { type ClassificationResult, VALID_PRODUCT_TYPES } from './product-type-classifier'

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions'
const DEEPSEEK_MODEL = 'deepseek-v4-flash'
const DEEPSEEK_TIMEOUT_MS = 30_000

export type DescriptionRewriteResult = {
  description: string | null
  priceRange: 1 | 2 | 3 | null
  productTags: string[]
}

const DESCRIPTION_REWRITE_WITH_DETAILS_SYSTEM_PROMPT = `${DESCRIPTION_SYSTEM_PROMPT}

請只回傳 JSON 物件，不要加入 Markdown 或額外說明。格式：
{
  "description": "繁體中文品牌簡介",
  "priceRange": 1 | 2 | 3 | null,
  "productTags": ["具體商品類型"]
}

priceRange 分級：
- 1：平價／入門，平均商品價格低於 US$50
- 2：中價位，平均商品價格約 US$50-200
- 3：高價／精品，平均商品價格高於 US$200
- 若價格線索不足，回傳 null

productTags 請擷取 2 到 5 個具體商品描述，例如「陶瓷馬克杯」、「亞麻圍裙」、「皮革托特包」。不要使用寬泛分類，例如「服飾」、「配件」、「家居」。若資料不清楚，回傳 []。`

function parseDescriptionRewriteResult(content: string): DescriptionRewriteResult {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>
    const rawDescription = parsed.description
    const rawPriceRange = parsed.priceRange
    const rawProductTags = parsed.productTags
    const description = typeof rawDescription === 'string' && rawDescription.trim().length >= 20
      ? rawDescription.trim()
      : null
    const priceRange = rawPriceRange === 1 || rawPriceRange === 2 || rawPriceRange === 3
      ? rawPriceRange
      : null
    const productTags = Array.isArray(rawProductTags)
      ? [...new Set(rawProductTags
        .filter((tag): tag is string => typeof tag === 'string')
        .map((tag) => tag.trim())
        .filter(Boolean))]
      : []

    return {
      description,
      priceRange,
      productTags: productTags.length >= 2 ? productTags.slice(0, 5) : [],
    }
  } catch {
    return {
      description: content.length >= 20 ? content : null,
      priceRange: null,
      productTags: [],
    }
  }
}

export async function rewriteBrandDescription(
  brandName: string,
  existingDescription: string | null,
  snippets: string[]
): Promise<DescriptionRewriteResult | null> {
  const token = process.env.DEEPSEEK_API_KEY
  if (!token) return null
  if (snippets.length === 0 && !existingDescription) return null

  const userContent = [
    `品牌名稱：${brandName}`,
    existingDescription ? `現有描述：${existingDescription}` : '',
    snippets.length > 0 ? `搜尋摘要：\n${snippets.slice(0, 5).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEEPSEEK_TIMEOUT_MS)

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
          { role: 'system', content: DESCRIPTION_REWRITE_WITH_DETAILS_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        max_tokens: 400,
        temperature: 0.1,
        thinking: { type: 'disabled' },
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      console.error(`  → description rewrite failed: HTTP ${res.status}`)
      return null
    }

    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }

    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) {
      console.error(`  → description rewrite: empty response, data=${JSON.stringify(data).slice(0, 200)}`)
      return null
    }
    if (content.length < 20) {
      console.error(`  → description rewrite: too short (${content.length} chars): ${content}`)
      return null
    }
    return parseDescriptionRewriteResult(content)
  } catch (err) {
    console.error(`  → description rewrite failed: ${err instanceof Error ? err.message : err}`)
    return null
  } finally {
    clearTimeout(timeout)
  }
}

export async function rewriteAndClassifyBrand(
  brandName: string,
  existingDescription: string | null,
  snippets: string[]
): Promise<{ description: string | null; classification: ClassificationResult | null }> {
  const token = process.env.DEEPSEEK_API_KEY
  if (!token) return { description: null, classification: null }
  if (snippets.length === 0 && !existingDescription) return { description: null, classification: null }

  const userContent = [
    `品牌名稱：${brandName}`,
    existingDescription ? `現有描述：${existingDescription}` : '',
    snippets.length > 0 ? `搜尋摘要：\n${snippets.slice(0, 5).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEEPSEEK_TIMEOUT_MS)

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
          { role: 'system', content: DESCRIPTION_AND_CLASSIFY_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        max_tokens: 400,
        temperature: 0.1,
        thinking: { type: 'disabled' },
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      console.warn(`  → combined rewrite/classification failed: HTTP ${res.status}`)
      return { description: null, classification: null }
    }

    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }

    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) {
      console.warn(`  → combined rewrite/classification: empty response, data=${JSON.stringify(data).slice(0, 200)}`)
      return { description: null, classification: null }
    }

    try {
      const parsed = JSON.parse(content) as Record<string, unknown>
      const rawDescription = parsed.description
      const productType = parsed.productType
      const confidence = parsed.confidence
      const description = typeof rawDescription === 'string' && rawDescription.trim().length >= 20
        ? rawDescription.trim()
        : null
      const classification: ClassificationResult | null = typeof productType === 'string' &&
        VALID_PRODUCT_TYPES.has(productType) &&
        (confidence === 'high' || confidence === 'medium' || confidence === 'low')
        ? { productType, confidence: confidence as ClassificationResult['confidence'] }
        : null

      return { description, classification }
    } catch {
      const description = content.length >= 20 ? content : null
      return { description, classification: null }
    }
  } catch (err) {
    console.warn(`  → combined rewrite/classification failed: ${err instanceof Error ? err.message : err}`)
    return { description: null, classification: null }
  } finally {
    clearTimeout(timeout)
  }
}
