import { DESCRIPTION_SYSTEM_PROMPT } from '@/lib/prompts'
import { createDeepSeekClient, parseDeepSeekJson } from './deepseek-client'

const DEEPSEEK_TIMEOUT_MS = 30_000

export type DescriptionRewriteResult = {
  description: string | null
  priceRange: 1 | 2 | 3 | null
  productTags: string[]
  rawResponse?: unknown
}

const DESCRIPTION_REWRITE_WITH_DETAILS_SYSTEM_PROMPT = `${DESCRIPTION_SYSTEM_PROMPT}

請只回傳 JSON 物件，不要加入 Markdown 或額外說明。格式：
{
  "description": "繁體中文品牌簡介",
  "priceRange": 1 | 2 | 3 | null,
  "productTags": ["具體商品類型"]
}

priceRange 分級：
- 1：平價／入門，平均商品價格低於 NT$1,000
- 2：中價位，平均商品價格約 NT$1,000-5,000
- 3：高價／精品，平均商品價格高於 NT$5,000
- 若價格線索不足，回傳 null

productTags 請擷取 2 到 5 個具體商品描述，例如「陶瓷馬克杯」、「亞麻圍裙」、「皮革托特包」。不要使用寬泛分類，例如「服飾」、「配件」、「家居」。若資料不清楚，回傳 []。`

export function parseDescriptionRewriteResult(content: string): DescriptionRewriteResult {
  const parsed = parseDeepSeekJson<Record<string, unknown>>(content)

  if (!parsed) {
    return {
      description: null,
      priceRange: null,
      productTags: [],
    }
  }

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

  const client = createDeepSeekClient({ apiKey: token })

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { response, data, content } = await client.chat({
        system: DESCRIPTION_REWRITE_WITH_DETAILS_SYSTEM_PROMPT,
        user: userContent,
        json: true,
        timeoutMs: DEEPSEEK_TIMEOUT_MS,
        maxTokens: 400,
        temperature: 0.1,
      })

      if (!response.ok) {
        console.error(`  → description rewrite failed: HTTP ${response.status}`)
        return null
      }

      if (!content) {
        console.error(`  → description rewrite: empty response, data=${JSON.stringify(data).slice(0, 200)}`)
        return null
      }

      const parsed = parseDeepSeekJson<Record<string, unknown>>(content)
      if (!parsed) {
        if (attempt === 0) {
          continue
        }

        return { description: null, priceRange: null, productTags: [], rawResponse: data }
      }

      return { ...parseDescriptionRewriteResult(content), rawResponse: data }
    }

    return { description: null, priceRange: null, productTags: [] }
  } catch (err) {
    console.error(`  → description rewrite failed: ${err instanceof Error ? err.message : err}`)
    return null
  }
}
