import type { Brand } from '@/lib/types'

type TFn = (key: string, params?: Record<string, unknown>) => string

type FaqItem = {
  question: string
  answer: string
}

type FaqGenerator = {
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

function truncate<T>(items: T[], limit = 3): T[] {
  return items.slice(0, limit)
}

function collectPurchaseChannels(brand: Brand): string[] {
  const channels: string[] = []

  if (hasValue(brand.purchaseWebsite)) channels.push('website')
  if (hasValue(brand.purchasePinkoi)) channels.push('Pinkoi')
  if (hasValue(brand.purchaseShopee)) channels.push('Shopee')

  return channels
}

function collectRetailLocations(brand: Brand): string[] {
  return truncate((brand.retailLocations ?? []).map((location) => location.name).filter(Boolean))
}

function collectSocialAccounts(brand: Brand): string[] {
  const accounts: string[] = []

  if (hasValue(brand.socialInstagram)) accounts.push('Instagram')
  if (hasValue(brand.socialThreads)) accounts.push('Threads')
  if (hasValue(brand.socialFacebook)) accounts.push('Facebook')

  return accounts
}

function buildWhereToBuyAnswer(brand: Brand, t: TFn): string {
  const channels = collectPurchaseChannels(brand)
  return t('brandFaq.whereToBuy.answer', { brandName: brand.name, channels: truncate(channels).join(', ') })
}

function buildPhysicalStoresAnswer(brand: Brand, t: TFn): string {
  return t('brandFaq.hasPhysicalStores.answer', {
    brandName: brand.name,
    locations: collectRetailLocations(brand).join(', '),
  })
}

function buildMainProductsAnswer(brand: Brand, t: TFn): string {
  const category = brand.category
  const productTags = truncate(brand.productTags ?? []).join(', ')

  if (category && productTags) {
    return t('brandFaq.mainProducts.answerWithCategoryAndTags', {
      brandName: brand.name,
      category,
      productTags,
    })
  }

  if (category) {
    return t('brandFaq.mainProducts.answerWithCategory', {
      brandName: brand.name,
      category,
    })
  }

  return t('brandFaq.mainProducts.answerWithTags', {
    brandName: brand.name,
    productTags,
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
  })
}

function buildOfficialAccountsAnswer(brand: Brand, t: TFn): string {
  return t('brandFaq.officialAccounts.answer', {
    brandName: brand.name,
    accounts: collectSocialAccounts(brand).join(', '),
  })
}

function buildReputationAnswer(brand: Brand, t: TFn): string {
  return t('brandFaq.reputation.answer', {
    brandName: brand.name,
    summary: brand.reputationSummary?.text ?? '',
  })
}

function buildManufacturingAnswer(brand: Brand, t: TFn): string {
  const manufacturing = brand.manufacturing

  return t('brandFaq.manufacturing.answer', {
    brandName: brand.name,
    details: [manufacturing?.factoryLocation, manufacturing?.productionModel].filter(Boolean).join(', '),
  })
}

function buildCertificationsAnswer(brand: Brand, t: TFn): string {
  return t('brandFaq.certifications.answer', {
    brandName: brand.name,
    certList: truncate((brand.certifications ?? []).map((cert) => cert.name)).join(', '),
  })
}

function buildReturnPolicyAnswer(brand: Brand, t: TFn): string {
  const policies = brand.policies

  return t('brandFaq.returnPolicy.answer', {
    brandName: brand.name,
    details: [policies?.returns, policies?.warranty].filter(Boolean).join(' '),
  })
}

function buildInternationalShippingAnswer(brand: Brand, t: TFn): string {
  const shipsInternational = brand.policies?.shipsInternational

  return t('brandFaq.internationalShipping.answer', {
    brandName: brand.name,
    details:
      shipsInternational === true
        ? 'Yes, this brand ships internationally.'
        : 'No, this brand does not ship internationally.',
  })
}

const FAQ_GENERATORS: FaqGenerator[] = [
  {
    condition: (brand) => brand.mitStatus === 'verified' || !!brand.mitStory,
    questionKey: 'brandFaq.isMadeInTaiwan.question',
    buildAnswer: (brand, t) => {
      const stampsAnswer = t('brandFaq.isMadeInTaiwan.answer', { brandName: brand.name })
      if (brand.mitStory && brand.mitStatus === 'verified') {
        return `${brand.mitStory}\n\n${stampsAnswer}`
      }
      if (brand.mitStory) {
        return brand.mitStory
      }
      return stampsAnswer
    },
  },
  {
    condition: (brand) => [brand.purchaseWebsite, brand.purchasePinkoi, brand.purchaseShopee].some(hasValue),
    questionKey: 'brandFaq.whereToBuy.question',
    buildAnswer: buildWhereToBuyAnswer,
  },
  {
    condition: (brand) => (brand.retailLocations?.length ?? 0) > 0,
    questionKey: 'brandFaq.hasPhysicalStores.question',
    buildAnswer: buildPhysicalStoresAnswer,
  },
  {
    condition: (brand) => Boolean(brand.category) || (brand.productTags?.length ?? 0) > 0,
    questionKey: 'brandFaq.mainProducts.question',
    buildAnswer: buildMainProductsAnswer,
  },
  {
    condition: (brand) => [1, 2, 3].includes(brand.priceRange ?? 0),
    questionKey: 'brandFaq.priceRange.question',
    buildAnswer: buildPriceRangeAnswer,
  },
  {
    condition: (brand) => Boolean(brand.foundingYear),
    questionKey: 'brandFaq.whenFounded.question',
    buildAnswer: buildFoundedAnswer,
  },
  {
    condition: (brand) => [brand.socialInstagram, brand.socialThreads, brand.socialFacebook].some(hasValue),
    questionKey: 'brandFaq.officialAccounts.question',
    buildAnswer: buildOfficialAccountsAnswer,
  },
  {
    condition: (brand) => Boolean(brand.reputationSummary?.text),
    questionKey: 'brandFaq.reputation.question',
    buildAnswer: buildReputationAnswer,
  },
  {
    condition: (brand) => Boolean(brand.manufacturing?.factoryLocation || brand.manufacturing?.productionModel),
    questionKey: 'brandFaq.manufacturing.question',
    buildAnswer: buildManufacturingAnswer,
  },
  {
    condition: (brand) => (brand.certifications?.length ?? 0) > 0,
    questionKey: 'brandFaq.certifications.question',
    buildAnswer: buildCertificationsAnswer,
  },
  {
    condition: (brand) => Boolean(brand.policies?.returns || brand.policies?.warranty),
    questionKey: 'brandFaq.returnPolicy.question',
    buildAnswer: buildReturnPolicyAnswer,
  },
  {
    condition: (brand) => brand.policies?.shipsInternational != null,
    questionKey: 'brandFaq.internationalShipping.question',
    buildAnswer: buildInternationalShippingAnswer,
  },
]

export function buildBrandFaq(brand: Brand, t: TFn): FaqItem[] {
  return FAQ_GENERATORS.filter((generator) => generator.condition(brand)).map((generator) => ({
    question: t(generator.questionKey, { brandName: brand.name }),
    answer: generator.buildAnswer(brand, t),
  }))
}

export function buildBrandIntro(brand: Brand, t: TFn): string {
  const parts: string[] = []

  if (brand.category) {
    parts.push(t('brandIntro.identity', { brandName: brand.name, category: brand.category }))
  } else {
    parts.push(t('brandIntro.identityNoCat', { brandName: brand.name }))
  }

  if (brand.foundingYear) {
    parts.push(t('brandIntro.founded', { year: brand.foundingYear }))
  }

  if (brand.mitStatus === 'verified') {
    parts.push(t('brandIntro.mitVerified'))
  }

  if ([1, 2, 3].includes(brand.priceRange ?? 0)) {
    const rangeKey = PRICE_RANGE_KEYS[brand.priceRange as 1 | 2 | 3]
    parts.push(t('brandIntro.price', { range: t(rangeKey) }))
  }

  if ([brand.purchaseWebsite, brand.purchasePinkoi, brand.purchaseShopee].some(hasValue)) {
    parts.push(t('brandIntro.purchase', { channels: truncate(collectPurchaseChannels(brand)).join(', ') }))
  }

  return parts.join(' ')
}
