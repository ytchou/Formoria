import { describe, expect, it } from 'vitest'
import { getBrandIndexability } from './brand-indexability'

const englishDescription =
  'A Taiwanese studio creating practical home goods with carefully selected materials and a restrained visual language for everyday living.'
const englishBlurb =
  'Practical Taiwanese home goods made with carefully selected materials.'

describe('getBrandIndexability', () => {
  it('keeps an approved Chinese page eligible without English copy', () => {
    expect(
      getBrandIndexability({
        description: '以台灣日常生活為靈感，設計耐用而實用的居家用品。',
        descriptionEn: null,
        blurbEn: null,
      }),
    ).toEqual({ 'zh-TW': true, en: false })
  })

  it('makes both locales eligible when English description and blurb are valid', () => {
    expect(
      getBrandIndexability({
        description: '以台灣日常生活為靈感，設計耐用而實用的居家用品。',
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
})

