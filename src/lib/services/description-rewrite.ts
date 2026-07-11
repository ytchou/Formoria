import { DESCRIPTION_SYSTEM_PROMPT } from '@/lib/prompts'
import { buildEnrichmentConfig } from '@/lib/constants/enrichment-config'
import { createDeepSeekClient, parseDeepSeekJson } from './deepseek-client'
import { validateLocalizedText, detectAiArtifacts } from './enrich-validators'
import { parseExtractionResult } from './product-type-classifier'

const DEEPSEEK_TIMEOUT_MS = 30_000
const ZH_DESCRIPTION_BAND = [150, 400] as const
const EN_DESCRIPTION_BAND = [300, 700] as const
const ZH_BLURB_BAND = [40, 80] as const
const EN_BLURB_BAND = [60, 150] as const

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
  reputationSummary: { text: string; textEn: string | null; sources: { url: string }[] } | null
  faq: Array<{ category: string; question: string; answer: string }> | null
  stockists: Array<{ name: string; city: string | null; type: 'chain' | 'independent' }> | null
  mitIndicators: { mentioned: boolean; evidence: string[]; confidence: string } | null
  validationRejections: Array<{
    field: 'description_zh' | 'description_en' | 'blurb_zh' | 'blurb_en'
    reasons: string[]
    warnings: string[]
    attempt: number
  }>
  rawResponse?: unknown
}

export type DescriptionAttemptInput = {
  brandName: string
  existingDescription: string | null
  snippets: string[]
  siteContent: string | null
}

export type DescriptionAttempt = {
  attempt: number
  input: DescriptionAttemptInput
  rawResponse: unknown
  parsed: DescriptionRewriteResult
  validationRejections: DescriptionRewriteResult['validationRejections']
  latencyMs: number
  config: unknown
}

type DescriptionRewriteOutput = {
  result: DescriptionRewriteResult
  attempts: DescriptionAttempt[]
}


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
      reputationSummary: null,
      faq: null,
      stockists: null,
      mitIndicators: null,
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

  const rawRep = parsed.reputation_summary
  const reputationSummary = rawRep && typeof rawRep === 'object' && !Array.isArray(rawRep)
    ? (() => {
        const rep = rawRep as Record<string, unknown>
        const text = typeof rep.text === 'string' && rep.text.trim().length > 0 ? rep.text.trim() : null
        const textEn = typeof rep.text_en === 'string' && rep.text_en.trim().length > 0 ? rep.text_en.trim() : null
        const sources = Array.isArray(rep.sources)
          ? rep.sources.filter((s: unknown): s is { url: string } =>
              typeof s === 'object' && s !== null && typeof (s as Record<string, unknown>).url === 'string'
            )
          : []
        return text && sources.length > 0 ? { text, textEn, sources } : null
      })()
    : null

  const rawFaq = parsed.faq
  const faq = Array.isArray(rawFaq)
    ? rawFaq
        .filter((item): item is Record<string, unknown> =>
          typeof item === 'object' && item !== null &&
          typeof (item as Record<string, unknown>).question === 'string' &&
          typeof (item as Record<string, unknown>).answer === 'string' &&
          (item as Record<string, unknown>).question !== '' &&
          (item as Record<string, unknown>).answer !== ''
        )
        .map((item) => ({
          category: typeof item.category === 'string' ? item.category : 'custom',
          question: item.question as string,
          answer: item.answer as string,
        }))
    : null

  const ONLINE_ONLY_CHANNELS = new Set([
    'pinkoi', 'shopee', '蝦皮', 'momo', 'pchome', '博客來', 'yahoo',
    '官網', 'official', '品牌官網', '線上商店', 'online', 'amazon',
    '樂天', 'rakuten',
  ])
  const isOnlineOnly = (name: string) =>
    ONLINE_ONLY_CHANNELS.has(name.toLowerCase()) ||
    [...ONLINE_ONLY_CHANNELS].some((kw) => name.toLowerCase().includes(kw))

  const rawStockists = parsed.stockists
  const stockists = Array.isArray(rawStockists)
    ? rawStockists
        .filter((s): s is Record<string, unknown> =>
          typeof s === 'object' && s !== null && typeof (s as Record<string, unknown>).name === 'string'
        )
        .map((s) => ({
          name: s.name as string,
          city: typeof s.city === 'string' ? s.city : null,
          type: (s.type === 'chain' ? 'chain' : 'independent') as 'chain' | 'independent',
        }))
        .filter((s) => !isOnlineOnly(s.name))
    : null

  const rawMit = parsed.mit_indicators
  const mitIndicators = rawMit && typeof rawMit === 'object' && !Array.isArray(rawMit)
    ? (() => {
        const mit = rawMit as Record<string, unknown>
        const mentioned = mit.mentioned === true
        const evidence = Array.isArray(mit.evidence)
          ? mit.evidence.filter((e): e is string => typeof e === 'string')
          : []
        const confidence = typeof mit.confidence === 'string' ? mit.confidence : 'low'
        return mentioned && evidence.length > 0 ? { mentioned, evidence, confidence } : null
      })()
    : null

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
    reputationSummary,
    faq: faq && faq.length > 0 ? faq : null,
    stockists: stockists && stockists.length > 0 ? stockists : null,
    mitIndicators,
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

  const rejectAiArtifacts = (
    field: DescriptionRewriteResult['validationRejections'][number]['field'],
    value: string,
    locale: 'zh' | 'en'
  ): string | null => {
    const artifacts = detectAiArtifacts(value, locale)
    if (artifacts.length > 0) {
      validationRejections.push({ field, reasons: artifacts, warnings: [], attempt })
      return null
    }
    return value
  }

  if (descriptionZh) {
    const validation = validateLocalizedText(descriptionZh, 'zh', ZH_DESCRIPTION_BAND)
    const hasHardFailure = !validation.ok
    const hasWarnings = validation.warnings.length > 0
    if (hasHardFailure || hasWarnings) {
      validationRejections.push({ field: 'description_zh', reasons: validation.reasons, warnings: validation.warnings, attempt })
    }
    if (hasHardFailure) {
      descriptionZh = null
    }
    if (descriptionZh) {
      descriptionZh = rejectAiArtifacts('description_zh', descriptionZh, 'zh')
    }
  } else {
    validationRejections.push({ field: 'description_zh', reasons: ['missing'], warnings: [], attempt })
  }

  if (descriptionEn) {
    const validation = validateLocalizedText(descriptionEn, 'en', EN_DESCRIPTION_BAND)
    const hasHardFailure = !validation.ok
    const hasWarnings = validation.warnings.length > 0
    if (hasHardFailure || hasWarnings) {
      validationRejections.push({ field: 'description_en', reasons: validation.reasons, warnings: validation.warnings, attempt })
    }
    if (hasHardFailure) {
      descriptionEn = null
    }
    if (descriptionEn) {
      descriptionEn = rejectAiArtifacts('description_en', descriptionEn, 'en')
    }
  } else {
    validationRejections.push({ field: 'description_en', reasons: ['missing'], warnings: [], attempt })
  }

  if (blurbZh) {
    const validation = validateLocalizedText(blurbZh, 'zh', ZH_BLURB_BAND)
    const hasHardFailure = !validation.ok
    const hasWarnings = validation.warnings.length > 0
    if (hasHardFailure || hasWarnings) {
      validationRejections.push({ field: 'blurb_zh', reasons: validation.reasons, warnings: validation.warnings, attempt })
    }
    if (hasHardFailure) {
      blurbZh = null
    }
    if (blurbZh) {
      blurbZh = rejectAiArtifacts('blurb_zh', blurbZh, 'zh')
    }
  } else {
    validationRejections.push({ field: 'blurb_zh', reasons: ['missing'], warnings: [], attempt })
  }

  if (blurbEn) {
    const validation = validateLocalizedText(blurbEn, 'en', EN_BLURB_BAND)
    const hasHardFailure = !validation.ok
    const hasWarnings = validation.warnings.length > 0
    if (hasHardFailure || hasWarnings) {
      validationRejections.push({ field: 'blurb_en', reasons: validation.reasons, warnings: validation.warnings, attempt })
    }
    if (hasHardFailure) {
      blurbEn = null
    }
    if (blurbEn) {
      blurbEn = rejectAiArtifacts('blurb_en', blurbEn, 'en')
    }
  } else {
    validationRejections.push({ field: 'blurb_en', reasons: ['missing'], warnings: [], attempt })
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

const DESCRIPTION_CONFIG_PARAMS = {
  model: 'deepseek-v4-flash',
  maxTokens: 4500,
  temperature: 0.1,
  snippetLimit: 10,
  siteContentLimit: 4000,
  descZhBand: ZH_DESCRIPTION_BAND,
  descEnBand: EN_DESCRIPTION_BAND,
  blurbZhBand: ZH_BLURB_BAND,
  blurbEnBand: EN_BLURB_BAND,
}

export async function rewriteBrandDescription(
  brandName: string,
  existingDescription: string | null,
  snippets: string[],
  siteContent: string | null
): Promise<DescriptionRewriteOutput | null> {
  const token = process.env.DEEPSEEK_API_KEY
  if (!token) return null
  if (snippets.length === 0 && !existingDescription) return null

  const userContent = [
    `品牌名稱：${brandName}`,
    existingDescription ? `現有描述：${existingDescription}` : '',
    snippets.length > 0 ? `搜尋摘要：\n${snippets.slice(0, 10).join('\n')}` : '',
    siteContent ? `網站內容：\n${siteContent}` : '',
  ].filter(Boolean).join('\n\n')

  const attemptInput: DescriptionAttemptInput = {
    brandName,
    existingDescription,
    snippets: snippets.slice(0, 10),
    siteContent,
  }
  const attemptConfig = buildEnrichmentConfig(
    'description',
    DESCRIPTION_SYSTEM_PROMPT,
    DESCRIPTION_CONFIG_PARAMS as Record<string, unknown>
  )

  const client = createDeepSeekClient({ apiKey: token })
  let bestResult: DescriptionRewriteResult | null = null
  let acceptedDescriptionZh: string | null = null
  let acceptedDescriptionEn: string | null = null
  let acceptedBlurbZh: string | null = null
  let acceptedBlurbEn: string | null = null
  const allValidationRejections: DescriptionRewriteResult['validationRejections'] = []
  const attempts: DescriptionAttempt[] = []

  try {
    for (let attemptIndex = 0; attemptIndex < 2; attemptIndex += 1) {
      const retryInstruction = attemptIndex === 0 || allValidationRejections.length === 0
        ? ''
        : `\n\n前一次輸出未通過品質檢查：${JSON.stringify(allValidationRejections)}。請只修正不合格欄位。注意：description_zh 必須全文繁體中文，description_en 必須全文英文（品牌中文名可保留）。兩者獨立撰寫，不可只產出其中一種語言。`

      const startAt = Date.now()
      const { response, data, content } = await client.chat({
        system: DESCRIPTION_SYSTEM_PROMPT,
        user: `${userContent}${retryInstruction}`,
        json: true,
        timeoutMs: DEEPSEEK_TIMEOUT_MS,
        maxTokens: 4500,
        temperature: 0.1,
      })
      const latencyMs = Date.now() - startAt

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
        attempts.push({
          attempt: attemptIndex + 1,
          input: attemptInput,
          rawResponse: data,
          parsed: parseDescriptionRewriteResult('{}'),
          validationRejections: [{ field: 'description_zh' as const, reasons: ['parse_failed'], warnings: [], attempt: attemptIndex + 1 }],
          latencyMs,
          config: attemptConfig,
        })

        if (attemptIndex === 0) {
          continue
        }

        const emptyResult: DescriptionRewriteResult = {
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
          reputationSummary: null,
          faq: null,
          stockists: null,
          mitIndicators: null,
          validationRejections: [],
          rawResponse: data,
        }
        return { result: emptyResult, attempts }
      }

      const parsedResult = parseDescriptionRewriteResult(content)
      const validated = validateDescriptionFields(parsedResult, attemptIndex + 1)

      attempts.push({
        attempt: attemptIndex + 1,
        input: attemptInput,
        rawResponse: data,
        parsed: parsedResult,
        validationRejections: validated.validationRejections,
        latencyMs,
        config: attemptConfig,
      })

      allValidationRejections.push(...validated.validationRejections)
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
        validationRejections: allValidationRejections,
        rawResponse: {
          response: data,
          validationRejections: allValidationRejections,
        },
      }

      if (acceptedDescriptionZh && acceptedDescriptionEn && acceptedBlurbZh && acceptedBlurbEn) {
        return { result: bestResult, attempts }
      }
    }

    const finalResult = bestResult ?? {
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
      reputationSummary: null,
      faq: null,
      stockists: null,
      mitIndicators: null,
      validationRejections: [],
    }
    return { result: finalResult, attempts }
  } catch (err) {
    console.error(`  → description rewrite failed: ${err instanceof Error ? err.message : err}`)
    return null
  }
}
