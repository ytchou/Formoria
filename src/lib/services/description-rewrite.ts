import { DESCRIPTION_SYSTEM_PROMPT } from '@/lib/prompts'
import { buildEnrichmentConfig } from '@/lib/constants/enrichment-config'
import { parseDeepSeekJson } from './deepseek-client'
import { createAuditedDeepSeekClient, type LlmAuditContext } from './llm-audit'
import { validateLocalizedText, detectAiArtifacts } from './enrich-validators'
import { localizeToTW, stripAiToolArtifacts } from './taiwan-localization'
import { parseExtractionResult } from './product-type-classifier'
import { normalizeProductTags } from '@/lib/services/product-tags'

const DEEPSEEK_TIMEOUT_MS = 30_000
const ZH_DESCRIPTION_BAND = [150, 400] as const
const EN_DESCRIPTION_BAND = [300, 700] as const
const ZH_BLURB_BAND = [40, 80] as const
const EN_BLURB_BAND = [60, 150] as const

function localizeZhText(text: string): string {
  return /[一-鿿]/u.test(text) ? localizeToTW(text).text : text
}

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
  stockists: Array<{
    name: string
    city: string | null
    type: 'chain' | 'independent'
    address?: string | null
    venueName?: string | null
    floorOrCounter?: string | null
    evidenceRefs?: number[]
  }> | null
  mitIndicators: { mentioned: boolean; evidence: string[]; confidence: string } | null
  validationRejections: Array<{
    field: 'description_zh' | 'description_en' | 'blurb_zh' | 'blurb_en'
    reasons: string[]
    warnings: string[]
    attempt: number
  }>
  rejected?: { tag: string; reason: string }[]
  crossBranch?: string[]
  rawResponse?: unknown
}

type DescriptionAttemptInput = {
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
  const productTagsEnRaw = Array.isArray(rawProductTagsEn)
    ? rawProductTagsEn.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map(t => t.trim())
    : []

  const normalizedTags = normalizeProductTags(extraction.productTags, productTagsEnRaw)

  const rawRep = parsed.reputation_summary
  const reputationSummary = rawRep && typeof rawRep === 'object' && !Array.isArray(rawRep)
    ? (() => {
        const rep = rawRep as Record<string, unknown>
        const text = typeof rep.text === 'string' && rep.text.trim().length > 0
          ? localizeToTW(rep.text.trim()).text
          : null
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
          question: localizeZhText(item.question as string),
          answer: localizeZhText(item.answer as string),
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
          address: typeof s.address === 'string' ? s.address.trim() || null : null,
          venueName: typeof s.venue_name === 'string'
            ? s.venue_name.trim() || null
            : typeof s.venueName === 'string'
              ? s.venueName.trim() || null
              : null,
          floorOrCounter: typeof s.floor_or_counter === 'string'
            ? s.floor_or_counter.trim() || null
            : typeof s.floorOrCounter === 'string'
              ? s.floorOrCounter.trim() || null
              : null,
          evidenceRefs: Array.isArray(s.evidence_refs)
            ? s.evidence_refs.filter((reference): reference is number => Number.isInteger(reference) && reference > 0)
            : Array.isArray(s.evidenceRefs)
              ? s.evidenceRefs.filter((reference): reference is number => Number.isInteger(reference) && reference > 0)
              : [],
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

  const acceptedTags = normalizedTags.tags.length >= 1 ? normalizedTags.tags : []
  const acceptedTagsEn = normalizedTags.tags.length >= 1 ? normalizedTags.tagsEn : []

  return {
    description_zh: descriptionZh,
    description_en: descriptionEn,
    description: descriptionZh,
    blurb_zh: blurbZh,
    blurb_en: blurbEn,
    priceRange: extraction.priceRange,
    productTags: acceptedTags,
    productTagsEn: acceptedTagsEn,
    city: extraction.city,
    foundingYear: extraction.foundingYear,
    reputationSummary,
    faq: faq && faq.length > 0 ? faq : null,
    stockists: stockists && stockists.length > 0 ? stockists : null,
    mitIndicators,
    validationRejections: [],
    rejected: normalizedTags.rejected,
    crossBranch: normalizedTags.crossBranch,
  }
}

function validateDescriptionFields(
  parsed: DescriptionRewriteResult,
  attempt: number,
  brandName?: string | null
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

  const rejectPricingInformation = (
    field: DescriptionRewriteResult['validationRejections'][number]['field'],
    value: string,
    locale: 'zh' | 'en'
  ): string | null => {
    if (!containsPricingInformation(value, locale)) return value
    validationRejections.push({ field, reasons: ['pricing_information'], warnings: [], attempt })
    return null
  }

  if (descriptionZh) {
    const validation = validateLocalizedText(descriptionZh, 'zh', ZH_DESCRIPTION_BAND, brandName)
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
    if (descriptionZh) {
      descriptionZh = rejectPricingInformation('description_zh', descriptionZh, 'zh')
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
    if (descriptionEn) {
      descriptionEn = rejectPricingInformation('description_en', descriptionEn, 'en')
    }
  } else {
    validationRejections.push({ field: 'description_en', reasons: ['missing'], warnings: [], attempt })
  }

  if (blurbZh) {
    const validation = validateLocalizedText(blurbZh, 'zh', ZH_BLURB_BAND, brandName)
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
    if (blurbZh) {
      blurbZh = rejectPricingInformation('blurb_zh', blurbZh, 'zh')
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
    if (blurbEn) {
      blurbEn = rejectPricingInformation('blurb_en', blurbEn, 'en')
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

function containsPricingInformation(value: string, locale: 'zh' | 'en'): boolean {
  const sentences = value.split(locale === 'zh' ? /[。！？]/u : /[.!?]+\s+/u)
  return sentences.some((sentence) => {
    if (locale === 'zh') {
      if (/(?:價格|價位|價錢|售價|定價|加價|平價|中價|高價|低價|千元即可入手|不再昂貴|折扣|優惠|促銷|特價|買一送一|滿額)/u.test(sentence)) {
        return true
      }
      const hasMoney = /(?:NT[$.]?|TWD|新台幣|台幣)\s*[\d,]+|[\d,]+\s*元/u.test(sentence)
      const isNonPricingAmount = /(?:保險|理賠|集資|募資|銷售額|業績|佳績)/u.test(sentence)
      return hasMoney && !isNonPricingAmount
    }

    if (/\b(?:prices?|priced|pricing|affordable|budget(?:-friendly)?|discount(?:ed|s)?|promotion(?:al|s)?)\b|\b(?:on sale|sale price)\b/iu.test(sentence)) {
      return true
    }
    const hasMoney = /(?:NT\$|TWD|US\$|\$)\s*[\d,]+/iu.test(sentence)
    const isNonPricingAmount = /\b(?:insurance|insured|coverage|crowdfunding|fundraising|raised|sales|revenue)\b/iu.test(sentence)
    return hasMoney && !isNonPricingAmount
  })
}

const RETRY_FIELD_BANDS = {
  description_zh: ZH_DESCRIPTION_BAND,
  description_en: EN_DESCRIPTION_BAND,
  blurb_zh: ZH_BLURB_BAND,
  blurb_en: EN_BLURB_BAND,
} as const

const RETRY_FIELD_UNITS: Record<keyof typeof RETRY_FIELD_BANDS, string> = {
  description_zh: '字',
  description_en: 'characters',
  blurb_zh: '字',
  blurb_en: 'characters',
}

/** Non-length rejection reasons, mapped to the edit that actually clears them. */
const RETRY_REASON_GUIDANCE: Record<string, string> = {
  language_purity:
    '語言不純：請全文改為該欄位指定語言，且連續拉丁字母單詞不可超過 2 個（外文專有名詞請改寫為中文或用《》括住）',
  pricing_information: '含價格資訊：請移除所有售價、金額、價位級距、折扣與促銷描述',
  missing: '欄位缺漏：必須輸出此欄位',
  parse_failed: '無法解析：請只輸出單一 JSON 物件，不要加上說明文字或 Markdown',
}

/**
 * Turns the previous attempt's rejections into instructions the model can act on.
 *
 * The old retry passed `JSON.stringify(rejections)` verbatim, so a length miss
 * arrived as the bare token `length_band` — which says a bound was crossed but
 * not which one. Observed consequence: the model assumed "too long" and cut
 * further, so attempt 2 came back shorter than attempt 1 (125 字 -> 101 字,
 * 230 字 -> 111 字) and failed the same check again. Naming the measured length,
 * the target band, and the direction is what makes the second call worth
 * spending.
 */
export function buildDescriptionRetryInstruction(
  rejections: DescriptionRewriteResult['validationRejections'],
  parsed: Partial<
    Record<keyof typeof RETRY_FIELD_BANDS, string | null>
  > | null,
): string {
  // Only hard failures nulled a field; warnings kept their value and need no edit.
  const hardFailures = rejections.filter((rejection) => rejection.reasons.length > 0)
  if (hardFailures.length === 0) return ''

  const notesByField = new Map<string, Set<string>>()
  for (const rejection of hardFailures) {
    const notes = notesByField.get(rejection.field) ?? new Set<string>()
    for (const reason of rejection.reasons) {
      if (reason === 'length_band') {
        const band = RETRY_FIELD_BANDS[rejection.field]
        const unit = RETRY_FIELD_UNITS[rejection.field]
        const value = parsed?.[rejection.field]
        const length = typeof value === 'string' ? value.length : null
        if (length === null) {
          notes.add(`長度不符：必須介於 ${band[0]}-${band[1]} ${unit}`)
        } else if (length < band[0]) {
          notes.add(
            `長度不足：目前 ${length} ${unit}，少於下限 ${band[0]}，請「增加」至少 ${band[0] - length} ${unit}（目標 ${band[0]}-${band[1]} ${unit}）。` +
              `補字數請「多寫一個具體面向」——代表產品與品項細節、材料與工藝、製程或生產地、通路與販售方式、創辦背景與年份、所在城市、外界評價；` +
              `不可加形容詞或「用心」「堅持」「品質保證」這類無資訊句子，那會觸發套話檢查而同樣作廢`,
          )
        } else {
          notes.add(
            `長度超標：目前 ${length} ${unit}，超過上限 ${band[1]}，請「刪減」至少 ${length - band[1]} ${unit}（目標 ${band[0]}-${band[1]} ${unit}）`,
          )
        }
        continue
      }
      notes.add(RETRY_REASON_GUIDANCE[reason] ?? `未通過檢查：${reason}`)
    }
    notesByField.set(rejection.field, notes)
  }

  const lines = [...notesByField.entries()].map(
    ([field, notes]) => `- ${field}：${[...notes].join('；')}`,
  )

  return [
    '\n\n前一次輸出未通過品質檢查，請只修正以下欄位，其餘欄位維持原樣：',
    ...lines,
    '注意：description_zh 必須全文繁體中文，description_en 必須全文英文（品牌中文名可保留）。兩者獨立撰寫，不可只產出其中一種語言。',
  ].join('\n')
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
  siteContent: string | null,
  audit: Pick<LlmAuditContext, 'jobId' | 'target'>,
): Promise<DescriptionRewriteOutput | null> {
  const token = process.env.DEEPSEEK_API_KEY
  if (!token) return null
  if (snippets.length === 0 && !existingDescription) return null

  const sanitizedSnippets = snippets.slice(0, 10).map(stripAiToolArtifacts)
  const sanitizedSiteContent = siteContent ? stripAiToolArtifacts(siteContent) : null

  const userContent = [
    `品牌名稱：${brandName}`,
    existingDescription ? `現有描述：${existingDescription}` : '',
    sanitizedSnippets.length > 0 ? `搜尋摘要：\n${sanitizedSnippets.join('\n')}` : '',
    sanitizedSiteContent ? `網站內容：\n${sanitizedSiteContent}` : '',
  ].filter(Boolean).join('\n\n')

  const attemptInput: DescriptionAttemptInput = {
    brandName,
    existingDescription,
    snippets: sanitizedSnippets,
    siteContent: sanitizedSiteContent,
  }
  const attemptConfig = buildEnrichmentConfig(
    'description',
    DESCRIPTION_SYSTEM_PROMPT,
    DESCRIPTION_CONFIG_PARAMS as Record<string, unknown>
  )

  let bestResult: DescriptionRewriteResult | null = null
  let acceptedDescriptionZh: string | null = null
  let acceptedDescriptionEn: string | null = null
  let acceptedBlurbZh: string | null = null
  let acceptedBlurbEn: string | null = null
  let acceptedPriceRange: 1 | 2 | 3 | null = null
  const allValidationRejections: DescriptionRewriteResult['validationRejections'] = []
  const attempts: DescriptionAttempt[] = []
  const localizeAcceptedZh = (value: string | null): string | null =>
    value ? localizeToTW(value, { brandName }).text : null

  // The retry needs the previous attempt's own text to measure, so the pre-validation
  // parse is carried forward rather than the accumulated (already nulled) result.
  let lastRejections: DescriptionRewriteResult['validationRejections'] = []
  let lastParsed: DescriptionRewriteResult | null = null

  try {
    for (let attemptIndex = 0; attemptIndex < 2; attemptIndex += 1) {
      const retryInstruction =
        attemptIndex === 0 ? '' : buildDescriptionRetryInstruction(lastRejections, lastParsed)

      const startAt = Date.now()
      const client = createAuditedDeepSeekClient(
        {
          ...audit,
          phase: 'description',
          attempt: attemptIndex + 1,
          config: attemptConfig,
        },
        { apiKey: token },
      )
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
      const validated = validateDescriptionFields(parsedResult, attemptIndex + 1, brandName)

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
      lastRejections = validated.validationRejections
      lastParsed = parsedResult
      acceptedDescriptionZh ??= localizeAcceptedZh(validated.description_zh)
      acceptedDescriptionEn ??= validated.description_en
      acceptedBlurbZh ??= localizeAcceptedZh(validated.blurb_zh)
      acceptedBlurbEn ??= validated.blurb_en
      acceptedPriceRange ??= validated.priceRange
      bestResult = {
        ...validated,
        description_zh: acceptedDescriptionZh,
        description_en: acceptedDescriptionEn,
        description: acceptedDescriptionZh,
        blurb_zh: acceptedBlurbZh,
        blurb_en: acceptedBlurbEn,
        priceRange: acceptedPriceRange,
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
