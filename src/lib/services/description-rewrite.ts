import { type ClassificationResult, VALID_PRODUCT_TYPES } from './product-type-classifier'

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions'
const DEEPSEEK_MODEL = 'deepseek-chat'
const DEEPSEEK_TIMEOUT_MS = 30_000

const SYSTEM_PROMPT = `你是台灣品牌文案撰寫者。請根據提供的資料，撰寫一段品牌簡介（繁體中文）。

要求：
- 2-3 句，總字數 60-120 字
- 第一句說明品牌創立背景或核心產品
- 第二句突出品牌特色、工藝或台灣元素
- 第三句（選填）說明產品線或品牌願景
- 語氣客觀、簡潔，不使用行銷誇大用語
- 只輸出品牌簡介本身，不加標題或前綴`

const COMBINED_SYSTEM_PROMPT = `你是台灣品牌文案撰寫者與分類專家。請根據提供的資料完成兩項任務：

任務一：品牌簡介
- 2-3 句，總字數 60-120 字
- 第一句說明品牌創立背景或核心產品
- 第二句突出品牌特色、工藝或台灣元素
- 第三句（選填）說明產品線或品牌願景
- 語氣客觀、簡潔，不使用行銷誇大用語

任務二：產品分類
將品牌分類到最適合的類別：
- fashion: 服飾、鞋履、穿戴服裝
- bags-accessories: 包袋、皮件、配件
- jewelry: 飾品、珠寶
- beauty: 美妝、保養、清潔、香氛
- home: 居家用品、餐具、家具、廚具、園藝
- food-drink: 食品、飲料、茶、咖啡、農產品
- crafts: 手作工藝、文具、文創、藝術
- tech: 3C科技、電子產品
- outdoor: 戶外運動、健身
- kids-pets: 兒童、嬰兒、寵物用品

回傳 JSON 格式：{"description":"品牌簡介文字","productType":"類別","confidence":"high|medium|low"}
不要加任何其他文字。`

export async function rewriteBrandDescription(
  brandName: string,
  existingDescription: string | null,
  snippets: string[]
): Promise<string | null> {
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
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        max_tokens: 300,
        temperature: 0.3,
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
    return content
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
          { role: 'system', content: COMBINED_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        max_tokens: 400,
        temperature: 0.3,
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
