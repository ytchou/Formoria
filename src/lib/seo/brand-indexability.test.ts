import { describe, expect, it } from 'vitest'
import {
  getBrandIndexability,
  getBrandPromotion,
  type BrandIndexabilityInput,
  type BrandPromotionInput,
} from './brand-indexability'

const englishDescription =
  'A Taiwanese studio creating practical home goods with carefully selected materials and a restrained visual language for everyday living.'
const englishBlurb =
  'Practical Taiwanese home goods made with carefully selected materials.'
const chineseDescription = '以台灣日常生活為靈感，設計耐用而實用的居家用品。'

function indexabilityInput(
  overrides: Partial<BrandIndexabilityInput> = {},
): BrandIndexabilityInput {
  return {
    description: chineseDescription,
    descriptionEn: englishDescription,
    blurbEn: englishBlurb,
    ...overrides,
  }
}

function promotionInput(
  overrides: Partial<BrandPromotionInput> = {},
): BrandPromotionInput {
  return {
    seoPromoted: true,
    descriptionEn: englishDescription,
    blurbEn: englishBlurb,
    ...overrides,
  }
}

describe('getBrandIndexability', () => {
  it('keeps an approved Chinese page eligible without English copy', () => {
    expect(
      getBrandIndexability({
        description: chineseDescription,
        descriptionEn: null,
        blurbEn: null,
      }),
    ).toEqual({ 'zh-TW': true, en: false })
  })

  it('makes both locales eligible when English description and blurb are valid', () => {
    expect(
      getBrandIndexability({
        description: chineseDescription,
        descriptionEn: englishDescription,
        blurbEn: englishBlurb,
      }),
    ).toEqual({ 'zh-TW': true, en: true })
  })

  it('rejects English copy that is missing or predominantly Chinese', () => {
    expect(
      getBrandIndexability({
        description: '台灣品牌介紹。',
        descriptionEn: '這仍然是中文內容，並不是英文翻譯。',
        blurbEn: englishBlurb,
      }).en,
    ).toBe(false)

    expect(
      getBrandIndexability({
        description: '台灣品牌介紹。',
        descriptionEn: englishDescription,
        blurbEn: null,
      }).en,
    ).toBe(false)
  })

  it('stays a text-presence check so the raised bar cannot leak into robots meta', () => {
    // DEV-1405 guard. A brand that fails the promotion bar must still be
    // indexable here — the whole point of the split is that an unvalidated
    // threshold delays discovery instead of emitting `noindex`. If someone
    // wires `seoPromoted` into this function, this fails.
    expect(
      getBrandIndexability(indexabilityInput({ description: '短。' })),
    ).toEqual({ 'zh-TW': true, en: true })
  })
})

describe('getBrandPromotion', () => {
  it('promotes both locales when the depth bar and English purity both pass', () => {
    expect(getBrandPromotion(promotionInput())).toEqual({
      'zh-TW': true,
      en: true,
    })
  })

  it('promotes zh-TW but not en when the English copy is predominantly Chinese', () => {
    expect(
      getBrandPromotion(
        promotionInput({ descriptionEn: '這仍然是中文內容，並不是英文翻譯。' }),
      ),
    ).toEqual({ 'zh-TW': true, en: false })
  })

  it('promotes zh-TW but not en when English copy is missing entirely', () => {
    expect(
      getBrandPromotion(
        promotionInput({ descriptionEn: null, blurbEn: null }),
      ),
    ).toEqual({ 'zh-TW': true, en: false })
  })

  it('withholds both locales when the depth bar fails, however good the English', () => {
    expect(getBrandPromotion(promotionInput({ seoPromoted: false }))).toEqual({
      'zh-TW': false,
      en: false,
    })
  })

  it('is strictly narrower than indexability for the same brand', () => {
    // The invariant the sitemap relies on: promotion can only ever remove
    // locales that indexability already allowed, never add one.
    const brand = {
      description: chineseDescription,
      descriptionEn: englishDescription,
      blurbEn: englishBlurb,
      seoPromoted: false,
    }
    const indexability = getBrandIndexability(brand)
    const promotion = getBrandPromotion(brand)

    for (const locale of ['zh-TW', 'en'] as const) {
      if (promotion[locale]) expect(indexability[locale]).toBe(true)
    }
  })
})
