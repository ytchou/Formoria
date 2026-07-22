import type { Brand } from '@/lib/types'
import {
  isConfirmedRetailLocation,
  isRetailChainChannel,
  normalizeRetailLocations,
} from '@/lib/brands/locations'
import { createServiceClient } from '@/lib/supabase/server'

type TFn = (key: string, params?: Record<string, unknown>) => string

type FaqItem = {
  id: string
  question: string
  answer: string
}

type BrandFaqEntry = {
  question_zh?: string | null
  answer_zh?: string | null
  question_en?: string | null
  answer_en?: string | null
}

const FAQ_COLUMN_ORDER = [
  'faq_products', 'faq_price', 'faq_where_to_buy',
  'faq_founded', 'faq_reputation',
  'faq_custom_1', 'faq_custom_2', 'faq_custom_3', 'faq_custom_4',
] as const

export async function getBrandFaq(
  brandId: string,
  brand: Brand,
  t: TFn,
  locale: string = 'zh-TW'
): Promise<FaqItem[]> {
  const supabase = createServiceClient()
  const { data: faqRow } = await supabase
    .from('brand_faq')
    .select('*')
    .eq('brand_id', brandId)
    .maybeSingle()

  const isZh = locale.startsWith('zh')
  const items: FaqItem[] = []

  if (faqRow) {
    for (const column of FAQ_COLUMN_ORDER) {
      const entry = faqRow[column] as BrandFaqEntry | null
      if (!entry) continue
      const question = isZh ? entry.question_zh : entry.question_en
      const answer = isZh ? entry.answer_zh : entry.answer_en
      if (question && answer) {
        items.push({ id: column, question, answer })
      }
    }
  }

  const generated = buildBrandFaq(brand, t, locale)
  if (items.length > 0) {
    const mitItem = generated.find((item) => item.id === 'made-in-taiwan')
    return mitItem ? [mitItem, ...items] : items
  }

  return generated
}

type FaqGenerator = {
  id: string
  condition: (brand: Brand, context: BrandFaqContext) => boolean
  questionKey: string
  buildAnswer: (
    brand: Brand,
    t: TFn,
    locale: string,
    context: BrandFaqContext,
  ) => string
}

const PRICE_RANGE_KEYS: Record<1 | 2 | 3, string> = {
  1: 'brandFaq.priceRanges.budget',
  2: 'brandFaq.priceRanges.midRange',
  3: 'brandFaq.priceRanges.premium',
}

function hasValue(value: string | null | undefined): value is string {
  return value != null && value.trim() !== ''
}

function hasMinLength(
  value: string | null | undefined,
  minLength: number,
): value is string {
  return value != null && value.trim().length >= minLength
}

function compactValues(values: Array<string | null | undefined>): string[] {
  return values.filter(hasValue)
}

function truncate<T>(items: T[], limit = 3): T[] {
  return items.slice(0, limit)
}

function collectPurchaseLinks(brand: Brand, t: TFn): string[] {
  const links: string[] = []

  if (hasValue(brand.purchaseWebsite))
    links.push(`[${t('brandFaq.channels.website')}](${brand.purchaseWebsite})`)
  if (hasValue(brand.purchasePinkoi))
    links.push(`[${t('brandFaq.channels.pinkoi')}](${brand.purchasePinkoi})`)
  if (hasValue(brand.purchaseShopee))
    links.push(`[${t('brandFaq.channels.shopee')}](${brand.purchaseShopee})`)

  return links
}

type RetailLocationSummary = {
  confirmed: string[]
  unconfirmed: string[]
  chains: string[]
}

type BrandFaqContext = {
  retailLocations: RetailLocationSummary
}

function collectRetailLocationSummary(
  locations: ReturnType<typeof normalizeRetailLocations>,
): RetailLocationSummary {
  const summary: RetailLocationSummary = {
    confirmed: [],
    unconfirmed: [],
    chains: [],
  }

  for (const location of locations) {
    if (isRetailChainChannel(location)) {
      summary.chains.push(location.name)
    } else if (isConfirmedRetailLocation(location)) {
      summary.confirmed.push(location.name)
    } else {
      summary.unconfirmed.push(location.name)
    }
  }

  return summary
}

function collectSocialLinks(brand: Brand): string[] {
  const links: string[] = []

  if (hasValue(brand.socialInstagram))
    links.push(`[Instagram](${brand.socialInstagram})`)
  if (hasValue(brand.socialThreads))
    links.push(`[Threads](${brand.socialThreads})`)
  if (hasValue(brand.socialFacebook))
    links.push(`[Facebook](${brand.socialFacebook})`)

  return links
}

function buildWhereToBuyAnswer(brand: Brand, t: TFn, _locale: string): string {
  const links = collectPurchaseLinks(brand, t)
  const sep = t('brandFaq.listSeparator')
  return t('brandFaq.whereToBuy.answer', {
    brandName: brand.name,
    channels: truncate(links).join(sep),
  })
}

function buildPhysicalStoresAnswer(
  _brand: Brand,
  t: TFn,
  locale: string,
  context: BrandFaqContext,
): string {
  const { confirmed, unconfirmed, chains } = context.retailLocations
  const sep = t('brandFaq.listSeparator')

  const details = [
    confirmed.length > 0
      ? `${t('locations.confirmedHeading')} (${confirmed.length}): ${confirmed.join(sep)}.`
      : null,
    unconfirmed.length > 0
      ? `${t('locations.unconfirmedHeading')} (${unconfirmed.length}): ${unconfirmed.join(sep)}. ${t('locations.unconfirmedDisclaimer')}`
      : null,
    chains.length > 0
      ? `${t('locations.chainHeading')} (${chains.length}): ${chains.join(sep)}. ${t('locations.chainDescription')}`
      : null,
  ].filter(hasValue)

  const availabilityDisclaimer = locale.startsWith('zh')
    ? '\u4ee5\u4e0a\u4e0d\u662f\u5373\u6642\u5eab\u5b58\u8cc7\u8a0a\uff1b\u9020\u8a2a\u6216\u4e0b\u55ae\u524d\uff0c\u8acb\u5148\u5411\u54c1\u724c\u6216\u901a\u8def\u78ba\u8a8d\u662f\u5426\u8ca9\u552e\u3002'
    : 'Availability is not live; check with the brand or retailer before visiting or ordering.'

  return `${details.join(' ')} ${availabilityDisclaimer}`
}

function buildMainProductsAnswer(brand: Brand, t: TFn, _locale: string): string {
  const category = brand.category
  const sep = t('brandFaq.listSeparator')
  const productTags = truncate(brand.productTags ?? []).join(sep)
  const context = buildBrandContext(brand, t)

  if (category && productTags) {
    return t('brandFaq.mainProducts.answerWithCategoryAndTags', {
      brandName: brand.name,
      category,
      productTags,
      context,
    })
  }

  return t('brandFaq.mainProducts.answerWithTags', {
    brandName: brand.name,
    productTags,
    context,
  })
}

function buildPriceRangeAnswer(brand: Brand, t: TFn, _locale: string): string {
  const rangeKey = brand.priceRange as 1 | 2 | 3
  return t('brandFaq.priceRange.answer', {
    brandName: brand.name,
    range: t(PRICE_RANGE_KEYS[rangeKey]),
  })
}

function buildFoundedAnswer(brand: Brand, t: TFn, _locale: string): string {
  return t('brandFaq.whenFounded.answer', {
    brandName: brand.name,
    year: brand.foundingYear,
    context: buildBrandContext(brand, t),
  })
}

function buildOfficialAccountsAnswer(brand: Brand, t: TFn, _locale: string): string {
  const sep = t('brandFaq.listSeparator')
  return t('brandFaq.officialAccounts.answer', {
    brandName: brand.name,
    accounts: collectSocialLinks(brand).join(sep),
  })
}

function buildReputationAnswer(brand: Brand, t: TFn, locale: string): string {
  const summary = locale === 'en'
    ? (brand.reputationSummary?.textEn ?? brand.reputationSummary?.text ?? '')
    : (brand.reputationSummary?.text ?? '')
  return t('brandFaq.reputation.answer', {
    brandName: brand.name,
    summary,
    context: buildBrandContext(brand, t),
  })
}

function buildBrandContext(brand: Brand, t: TFn): string {
  const details = compactValues([
    brand.city ? t('brandFaq.context.city', { city: brand.city }) : null,
    brand.foundingYear
      ? t('brandFaq.context.founded', { year: brand.foundingYear })
      : null,
  ])

  return details.length > 0
    ? t('brandFaq.context.suffix', {
        details: details.join(t('brandFaq.listSeparator')),
      })
    : ''
}

function buildMitAnswer(brand: Brand, t: TFn, _locale: string): string {
  if (brand.mitStatus === 'verified') {
    const verifiedAnswer = t('brandFaq.isMadeInTaiwan.answer', {
      brandName: brand.name,
    })
    const registrySource = t('brandFaq.isMadeInTaiwan.registrySource')
    return hasValue(brand.mitStory)
      ? `${brand.mitStory}\n\n${verifiedAnswer} ${registrySource}`
      : `${verifiedAnswer} ${registrySource}`
  }

  const scope = brand.mitDeclaredScope
    ? t(`brandFaq.isMadeInTaiwan.scopeLabels.${brand.mitDeclaredScope}`)
    : t('brandFaq.isMadeInTaiwan.scopeLabels.unspecified')
  const declaration = t('brandFaq.isMadeInTaiwan.declaredAnswer', {
    brandName: brand.name,
    scope,
  })
  const story = hasValue(brand.mitStory) ? `\n\n${brand.mitStory}` : ''

  return `${declaration}${story}`
}

const FAQ_GENERATORS: FaqGenerator[] = [
  {
    id: 'made-in-taiwan',
    condition: (brand) =>
      brand.mitStatus === 'declared' || brand.mitStatus === 'verified',
    questionKey: 'brandFaq.isMadeInTaiwan.question',
    buildAnswer: buildMitAnswer,
  },
  {
    id: 'where-to-buy',
    condition: (brand) =>
      [brand.purchaseWebsite, brand.purchasePinkoi, brand.purchaseShopee].some(
        hasValue,
      ),
    questionKey: 'brandFaq.whereToBuy.question',
    buildAnswer: buildWhereToBuyAnswer,
  },
  {
    id: 'physical-stores',
    condition: (_brand, context) =>
      context.retailLocations.confirmed.length > 0 ||
      context.retailLocations.unconfirmed.length > 0 ||
      context.retailLocations.chains.length > 0,
    questionKey: 'brandFaq.hasPhysicalStores.question',
    buildAnswer: buildPhysicalStoresAnswer,
  },
  {
    id: 'main-products',
    condition: (brand) => compactValues(brand.productTags ?? []).length > 0,
    questionKey: 'brandFaq.mainProducts.question',
    buildAnswer: buildMainProductsAnswer,
  },
  {
    id: 'price-range',
    condition: (brand) => [1, 2, 3].includes(brand.priceRange ?? 0),
    questionKey: 'brandFaq.priceRange.question',
    buildAnswer: buildPriceRangeAnswer,
  },
  {
    id: 'founded',
    condition: (brand) => Boolean(brand.foundingYear),
    questionKey: 'brandFaq.whenFounded.question',
    buildAnswer: buildFoundedAnswer,
  },
  {
    id: 'official-accounts',
    condition: (brand) =>
      [brand.socialInstagram, brand.socialThreads, brand.socialFacebook].some(
        hasValue,
      ),
    questionKey: 'brandFaq.officialAccounts.question',
    buildAnswer: buildOfficialAccountsAnswer,
  },
  {
    id: 'reputation',
    condition: (brand) => hasMinLength(brand.reputationSummary?.text, 10),
    questionKey: 'brandFaq.reputation.question',
    buildAnswer: buildReputationAnswer,
  },
]

export function buildBrandFaq(brand: Brand, t: TFn, locale: string = 'zh-TW'): FaqItem[] {
  const context: BrandFaqContext = {
    retailLocations: collectRetailLocationSummary(
      normalizeRetailLocations(brand.retailLocations),
    ),
  }

  return FAQ_GENERATORS.filter((generator) =>
    generator.condition(brand, context),
  ).map((generator) => ({
      id: generator.id,
      question:
        generator.id === 'physical-stores'
          ? `${t('sections.locationsAndRetailChannels')}: ${brand.name}`
          : t(generator.questionKey, { brandName: brand.name }),
      answer: generator.buildAnswer(brand, t, locale, context),
    }),
  )
}
