import { describe, it, expect } from 'vitest'
import { parseBrandCSV, curatedSubmissionToBrand } from '@/lib/services/brands'

const MIN_DESCRIPTION = 'A wonderful tea brand made in Taiwan with incredible quality and tradition.'

describe('parseBrandCSV', () => {
  it('parses basic CSV rows with headers', () => {
    const csv = `name,description,category\nTaiwan Tea Co,${MIN_DESCRIPTION},Food & Beverage`
    const rows = parseBrandCSV(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Taiwan Tea Co')
    expect(rows[0].description).toBe(MIN_DESCRIPTION)
    expect(rows[0].category).toBe('Food & Beverage')
  })

  it('handles quoted fields containing commas', () => {
    const csv = `name,description,category\n"Tea, Coffee & More",${MIN_DESCRIPTION},Food`
    const rows = parseBrandCSV(csv)
    expect(rows[0].name).toBe('Tea, Coffee & More')
  })

  it('handles pipe-delimited array fields (valueTags)', () => {
    const csv = `name,description,category,valueTags\nTest Brand,${MIN_DESCRIPTION},Food,handmade|local`
    const rows = parseBrandCSV(csv)
    expect(rows[0].valueTags).toEqual(['handmade', 'local'])
  })

  it('returns empty array for empty input', () => {
    expect(parseBrandCSV('')).toEqual([])
  })

  it('returns empty array for header-only CSV', () => {
    expect(parseBrandCSV('name,description,category')).toEqual([])
  })

  it('skips blank rows', () => {
    const csv = `name,description,category\nTaiwan Tea,${MIN_DESCRIPTION},Food\n\nOther Brand,${MIN_DESCRIPTION},Apparel`
    const rows = parseBrandCSV(csv)
    expect(rows).toHaveLength(2)
  })
})

describe('curatedSubmissionToBrand', () => {
  const baseInput = {
    name: 'Taiwan Tea Co',
    slug: 'taiwan-tea-co',
    description: MIN_DESCRIPTION,
    category: 'Food & Beverage',
    productPhotos: [],
    purchaseLinks: [],
    socialLinks: { instagram: '', threads: '', facebook: '', website: '' },
    retailLocations: [],
    customerVoices: [],
    brandHighlights: null,
    region: null,
    valueTags: [],
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
      socialLinks: { instagram: '@test', threads: '', facebook: '', website: 'https://test.com' },
    }
    const result = curatedSubmissionToBrand(input)
    expect(result.purchaseWebsite).toBe('https://test.com')
  })

  it('trims brandHighlights and preserves null when empty', () => {
    const withHighlights = curatedSubmissionToBrand({ ...baseInput, brandHighlights: '  Great brand  ' })
    expect(withHighlights.brandHighlights).toBe('Great brand')

    const withNull = curatedSubmissionToBrand({ ...baseInput, brandHighlights: null })
    expect(withNull.brandHighlights).toBeNull()
  })
})
