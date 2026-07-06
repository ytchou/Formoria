import type { Brand } from '@/lib/types'

type TFn = (key: string, params?: Record<string, unknown>) => string

type FaqItem = {
  id: string
  question: string
  answer: string
}

type FaqGenerator = {
  id: string
  condition: (brand: Brand) => boolean
  questionKey: string
  buildAnswer: (brand: Brand, t: TFn) => string
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

function collectRetailLocations(brand: Brand): string[] {
  return truncate(
    (brand.retailLocations ?? [])
      .map((location) => location.name)
      .filter(Boolean),
  )
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

function buildWhereToBuyAnswer(brand: Brand, t: TFn): string {
  const links = collectPurchaseLinks(brand, t)
  const sep = t('brandFaq.listSeparator')
  return t('brandFaq.whereToBuy.answer', {
    brandName: brand.name,
    channels: truncate(links).join(sep),
  })
}

function buildPhysicalStoresAnswer(brand: Brand, t: TFn): string {
  const sep = t('brandFaq.listSeparator')
  return t('brandFaq.hasPhysicalStores.answer', {
    brandName: brand.name,
    locations: collectRetailLocations(brand).join(sep),
  })
}

function buildMainProductsAnswer(brand: Brand, t: TFn): string {
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

function buildPriceRangeAnswer(brand: Brand, t: TFn): string {
  const rangeKey = brand.priceRange as 1 | 2 | 3
  return t('brandFaq.priceRange.answer', {
    brandName: brand.name,
    range: t(PRICE_RANGE_KEYS[rangeKey]),
  })
}

function buildFoundedAnswer(brand: Brand, t: TFn): string {
  return t('brandFaq.whenFounded.answer', {
    brandName: brand.name,
    year: brand.foundingYear,
    context: buildBrandContext(brand, t),
  })
}

function buildOfficialAccountsAnswer(brand: Brand, t: TFn): string {
  const sep = t('brandFaq.listSeparator')
  return t('brandFaq.officialAccounts.answer', {
    brandName: brand.name,
    accounts: collectSocialLinks(brand).join(sep),
  })
}

function buildReputationAnswer(brand: Brand, t: TFn): string {
  return t('brandFaq.reputation.answer', {
    brandName: brand.name,
    summary: brand.reputationSummary?.text ?? '',
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

const FAQ_GENERATORS: FaqGenerator[] = [
  {
    id: 'made-in-taiwan',
    condition: (brand) =>
      brand.mitStatus === 'verified' || hasValue(brand.mitStory),
    questionKey: 'brandFaq.isMadeInTaiwan.question',
    buildAnswer: (brand, t) => {
      const stampsAnswer = t('brandFaq.isMadeInTaiwan.answer', {
        brandName: brand.name,
      })
      if (hasValue(brand.mitStory) && brand.mitStatus === 'verified') {
        return `${brand.mitStory}\n\n${stampsAnswer}`
      }
      if (hasValue(brand.mitStory)) {
        return brand.mitStory
      }
      return stampsAnswer
    },
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
    condition: (brand) => collectRetailLocations(brand).length > 0,
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

export function buildBrandFaq(brand: Brand, t: TFn): FaqItem[] {
  return FAQ_GENERATORS.filter((generator) => generator.condition(brand)).map(
    (generator) => ({
      id: generator.id,
      question: t(generator.questionKey, { brandName: brand.name }),
      answer: generator.buildAnswer(brand, t),
    }),
  )
}
