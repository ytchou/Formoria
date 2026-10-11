import { describe, it, expect } from 'vitest'
import { curatedSubmissionToBrand } from '@/lib/services/brands'

const MIN_DESCRIPTION =
  'A wonderful tea brand made in Taiwan with incredible quality and tradition.'

describe('curatedSubmissionToBrand', () => {
  const baseInput = {
    name: 'Taiwan Tea Co',
    slug: 'taiwan-tea-co',
    description: MIN_DESCRIPTION,
    categorySlug: 'Food & Beverage',
    productPhotos: [],
    purchaseLinks: [],
    socialLinks: { instagram: '', threads: '', facebook: '', website: '' },
    region: null,
  }

  it('sets status to approved and nulls sentinel fields', () => {
    const result = curatedSubmissionToBrand(baseInput)
    expect(result.status).toBe('approved')
    expect(result.heroImageUrl).toBeNull()
    expect(result.contactEmail).toBeNull()
    expect(result.foundingYear).toBeNull()
  })

  it('converts purchase link platform to purchaseShopee flat field', () => {
    const input = {
      ...baseInput,
      purchaseLinks: [{ platform: 'Shopee', url: 'https://shopee.tw/test' }],
    }
    const result = curatedSubmissionToBrand(input)
    expect(result.purchaseShopee).toBe('https://shopee.tw/test')
  })

  it('maps socialLinks.website to purchaseWebsite flat field', () => {
    const input = {
      ...baseInput,
      socialLinks: {
        instagram: '@test',
        threads: '',
        facebook: '',
        website: 'https://test.com',
      },
    }
    const result = curatedSubmissionToBrand(input)
    expect(result.purchaseWebsite).toBe('https://test.com')
  })
})
