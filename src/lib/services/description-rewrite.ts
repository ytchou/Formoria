import { DESCRIPTION_SYSTEM_PROMPT } from '@/lib/prompts'
import { createDeepSeekClient, parseDeepSeekJson } from './deepseek-client'
import { validateLocalizedText } from './enrich-validators'
import { parseExtractionResult } from './product-type-classifier'

const DEEPSEEK_TIMEOUT_MS = 30_000
const ZH_DESCRIPTION_BAND = [300, 600] as const
const EN_DESCRIPTION_BAND = [400, 900] as const
const ZH_BLURB_BAND = [60, 120] as const
const EN_BLURB_BAND = [80, 180] as const

export type DescriptionRewriteResult = {
  description_zh: string | null
  description_en: string | null
  description: string | null
  blurb_zh: string | null
  blurb_en: string | null
  priceRange: 1 | 2 | 3 | null
  productTags: string[]
  productTagsEn: string[]
  city: string | null
  foundingYear: number | null
  signatureProducts: string[]
  whereToBuy: string | null
  categoryMismatch: boolean
  validationRejections: Array<{
    field: 'description_zh' | 'description_en' | 'blurb_zh' | 'blurb_en'
    reasons: string[]
    attempt: number
  }>
  rawResponse?: unknown
}

const DESCRIPTION_REWRITE_WITH_DETAILS_SYSTEM_PROMPT = `${DESCRIPTION_SYSTEM_PROMPT}

請只回傳 JSON 物件，不要加入 Markdown 或額外說明。格式：
{
  "description_zh": "300-600 字繁體中文品牌簡介",
  "description_en": "400-900 characters English brand description",
  "blurb_zh": "60-120 字繁體中文品牌摘要，用於卡片顯示，精簡且吸引人",
  "blurb_en": "80-180 characters English brand summary for card display",
  "price_range": 1 | 2 | 3 | null,
  "product_tags": ["具體商品類型（繁體中文）"],
  "product_tags_en": ["specific product types (English)"],
  "city": "城市 slug 或 null（只能用以下值：taipei, new_taipei, taoyuan, taichung, tainan, kaohsiung, keelung, hsinchu_city, chiayi_city, hsinchu_county, miaoli, changhua, nantou, yunlin, chiayi_county, pingtung, yilan, hualien, taitung, penghu, kinmen, lienchiang）",
  "founding_year": 2015 | null,
  "signature_products": ["代表商品"],
  "where_to_buy": "通路摘要或 null",
  "category_mismatch": true | false
}

priceRange 分級：
- 1：平價／入門，平均商品價格低於 NT$1,000
- 2：中價位，平均商品價格約 NT$1,000-5,000
- 3：高價／精品，平均商品價格高於 NT$5,000
- 若價格線索不足，回傳 null

product_tags 請擷取 2 到 5 個具體商品描述，例如「陶瓷馬克杯」、「亞麻圍裙」、「皮革托特包」。不要使用寬泛分類，例如「服飾」、「配件」、「家居」。若資料不清楚，回傳 []。
product_tags_en 是 product_tags 的英文對應翻譯，必須數量與順序一致。

所有欄位只能使用提供來源中的事實；沒有根據的欄位回傳 null、[] 或 false。`

export function parseDescriptionRewriteResult(content: string): DescriptionRewriteResult {
  const parsed = parseDeepSeekJson<Record<string, unknown>>(content)
  const extraction = parseExtractionResult(content)

  if (!parsed) {
    return {
      description_zh: null,
      description_en: null,
      description: null,
      blurb_zh: null,
      blurb_en: null,
      priceRange: null,
      productTags: [],
      productTagsEn: [],
      city: null,
      foundingYear: null,
      signatureProducts: [],
      whereToBuy: null,
      categoryMismatch: false,
      validationRejections: [],
    }
  }

  const rawDescriptionZh = parsed.description_zh ?? parsed.description
  const rawDescriptionEn = parsed.description_en
  const descriptionZh = typeof rawDescriptionZh === 'string' && rawDescriptionZh.trim().length > 0
    ? rawDescriptionZh.trim()
    : null
  const descriptionEn = typeof rawDescriptionEn === 'string' && rawDescriptionEn.trim().length > 0
    ? rawDescriptionEn.trim()
    : null

  const rawBlurbZh = parsed.blurb_zh
  const rawBlurbEn = parsed.blurb_en
  const blurbZh = typeof rawBlurbZh === 'string' && rawBlurbZh.trim().length > 0
    ? rawBlurbZh.trim()
    : null
  const blurbEn = typeof rawBlurbEn === 'string' && rawBlurbEn.trim().length > 0
    ? rawBlurbEn.trim()
    : null

  const rawProductTagsEn = parsed.product_tags_en
  const productTagsEn = Array.isArray(rawProductTagsEn)
    ? rawProductTagsEn.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map(t => t.trim())
    : []

  return {
    description_zh: descriptionZh,
    description_en: descriptionEn,
    description: descriptionZh,
    blurb_zh: blurbZh,
    blurb_en: blurbEn,
    priceRange: extraction.priceRange,
    productTags: extraction.productTags.length >= 2 ? extraction.productTags : [],
    productTagsEn,
    city: extraction.city,
    foundingYear: extraction.foundingYear,
    signatureProducts: extraction.signatureProducts,
    whereToBuy: extraction.whereToBuy,
    categoryMismatch: extraction.categoryMismatch,
    validationRejections: [],
  }
}

function validateDescriptionFields(
  parsed: DescriptionRewriteResult,
  attempt: number
): DescriptionRewriteResult {
  const validationRejections: DescriptionRewriteResult['validationRejections'] = []
  let descriptionZh = parsed.description_zh
  let descriptionEn = parsed.description_en
  let blurbZh = parsed.blurb_zh
  let blurbEn = parsed.blurb_en

  if (descriptionZh) {
    const validation = validateLocalizedText(descriptionZh, 'zh', ZH_DESCRIPTION_BAND)
    if (!validation.ok) {
      validationRejections.push({ field: 'description_zh', reasons: validation.reasons, attempt })
      descriptionZh = null
    }
  } else {
    validationRejections.push({ field: 'description_zh', reasons: ['missing'], attempt })
  }

  if (descriptionEn) {
    const validation = validateLocalizedText(descriptionEn, 'en', EN_DESCRIPTION_BAND)
    if (!validation.ok) {
      validationRejections.push({ field: 'description_en', reasons: validation.reasons, attempt })
      descriptionEn = null
    }
  } else {
    validationRejections.push({ field: 'description_en', reasons: ['missing'], attempt })
  }

  if (blurbZh) {
    const validation = validateLocalizedText(blurbZh, 'zh', ZH_BLURB_BAND)
    if (!validation.ok) {
      validationRejections.push({ field: 'blurb_zh', reasons: validation.reasons, attempt })
      blurbZh = null
    }
  } else {
    validationRejections.push({ field: 'blurb_zh', reasons: ['missing'], attempt })
  }

  if (blurbEn) {
    const validation = validateLocalizedText(blurbEn, 'en', EN_BLURB_BAND)
    if (!validation.ok) {
      validationRejections.push({ field: 'blurb_en', reasons: validation.reasons, attempt })
      blurbEn = null
    }
  } else {
    validationRejections.push({ field: 'blurb_en', reasons: ['missing'], attempt })
  }

  return {
    ...parsed,
    description_zh: descriptionZh,
    description_en: descriptionEn,
    description: descriptionZh,
    blurb_zh: blurbZh,
    blurb_en: blurbEn,
    validationRejections,
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
  let bestResult: DescriptionRewriteResult | null = null
  let acceptedDescriptionZh: string | null = null
  let acceptedDescriptionEn: string | null = null
  let acceptedBlurbZh: string | null = null
  let acceptedBlurbEn: string | null = null
  const validationRejections: DescriptionRewriteResult['validationRejections'] = []

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const retryInstruction = attempt === 0 || validationRejections.length === 0
        ? ''
        : `\n\n前一次輸出未通過品質檢查：${JSON.stringify(validationRejections)}。請只修正不合格欄位，仍然只使用提供來源中的事實。`
      const { response, data, content } = await client.chat({
        system: DESCRIPTION_REWRITE_WITH_DETAILS_SYSTEM_PROMPT,
        user: `${userContent}${retryInstruction}`,
        json: true,
        timeoutMs: DEEPSEEK_TIMEOUT_MS,
        maxTokens: 2400,
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

        return {
          description_zh: null,
          description_en: null,
          description: null,
          blurb_zh: null,
          blurb_en: null,
          priceRange: null,
          productTags: [],
          productTagsEn: [],
          city: null,
          foundingYear: null,
          signatureProducts: [],
          whereToBuy: null,
          categoryMismatch: false,
          validationRejections: [],
          rawResponse: data,
        }
      }

      const validated = validateDescriptionFields(parseDescriptionRewriteResult(content), attempt + 1)
      validationRejections.push(...validated.validationRejections)
      acceptedDescriptionZh ??= validated.description_zh
      acceptedDescriptionEn ??= validated.description_en
      acceptedBlurbZh ??= validated.blurb_zh
      acceptedBlurbEn ??= validated.blurb_en
      bestResult = {
        ...validated,
        description_zh: acceptedDescriptionZh,
        description_en: acceptedDescriptionEn,
        description: acceptedDescriptionZh,
        blurb_zh: acceptedBlurbZh,
        blurb_en: acceptedBlurbEn,
        validationRejections,
        rawResponse: {
          response: data,
          validationRejections,
        },
      }

      if (acceptedDescriptionZh && acceptedDescriptionEn && acceptedBlurbZh && acceptedBlurbEn) {
        return bestResult
      }
    }

    return bestResult ?? {
      description_zh: null,
      description_en: null,
      description: null,
      blurb_zh: null,
      blurb_en: null,
      priceRange: null,
      productTags: [],
      productTagsEn: [],
      city: null,
      foundingYear: null,
      signatureProducts: [],
      whereToBuy: null,
      categoryMismatch: false,
      validationRejections: [],
    }
  } catch (err) {
    console.error(`  → description rewrite failed: ${err instanceof Error ? err.message : err}`)
    return null
  }
}
