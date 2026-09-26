import { describe, expect, it } from 'vitest'

import { keepRate, repairPassRate, type ProductsGoldenContext } from '../product-scorers'

const GOLDEN_SITE = 'https://brand.example'
const WITH_ORIGIN = '在台灣手工拉坯的陶瓷盤，直徑 21 公分，釉色溫潤。'

function rawProduct(officialUrl: string, overrides: Record<string, unknown> = {}) {
  return {
    name_zh: '陶瓷盤',
    name_en: null,
    category: 'fashion',
    subcategory: null,
    material: [],
    official_url: officialUrl,
    image_source_url: null,
    product_description_zh: WITH_ORIGIN,
    sources: [{ url: officialUrl, source_type: 'official', claim_zh: null }],
    ...overrides,
  }
}

describe('keepRate', () => {
  const context: ProductsGoldenContext = {
    siteUrl: GOLDEN_SITE,
    candidates: [`${GOLDEN_SITE}/products/plate`, `${GOLDEN_SITE}/products/bowl`],
    ownedHosts: [],
  }

  it('is accepted / raw from validateProductProposals', () => {
    const output = {
      evaluations: [],
      products: [
        rawProduct(`${GOLDEN_SITE}/products/plate`),
        rawProduct(`${GOLDEN_SITE}/products/bowl`, { name_zh: '陶瓷碗' }),
        // not a candidate: dropped
        rawProduct(`${GOLDEN_SITE}/products/guessed`, { name_zh: '猜測' }),
        // no category: dropped
        rawProduct(`${GOLDEN_SITE}/products/plate`, { name_zh: '無分類', category: null }),
      ],
    }
    expect(keepRate(output, context)).toBe(0.5)
  })

  it('is 0 when the model proposed nothing from a non-empty pool', () => {
    expect(keepRate({ evaluations: [], products: [] }, context)).toBe(0)
    expect(keepRate(null, context)).toBe(0)
  })

  it('is null when the pool had no candidates and the model proposed nothing', () => {
    expect(keepRate({ evaluations: [], products: [] }, { ...context, candidates: [] })).toBeNull()
  })
})

describe('repairPassRate', () => {
  const plate = `${GOLDEN_SITE}/products/plate`
  const bowl = `${GOLDEN_SITE}/products/bowl`
  const context: ProductsGoldenContext = {
    siteUrl: GOLDEN_SITE,
    candidates: [plate, bowl],
    ownedHosts: [],
    hardUrls: [plate, bowl],
  }

  it('is the share of hard entries that repairedProposalPasses accepts', () => {
    const output = {
      products: [
        rawProduct(plate),
        // moved off the brand's host: not a repair
        rawProduct('https://stranger-shop.example/products/bowl', { name_zh: '陶瓷碗' }),
      ],
    }
    expect(repairPassRate(output, context)).toBe(0.5)
  })

  it('is 1 when every hard entry comes back passing', () => {
    const output = { products: [rawProduct(plate), rawProduct(bowl, { name_zh: '陶瓷碗' })] }
    expect(repairPassRate(output, context)).toBe(1)
  })

  it('is null when the item has no hard entries', () => {
    expect(repairPassRate({ products: [rawProduct(plate)] }, { ...context, hardUrls: [] })).toBeNull()
  })
})
