import { describe, expect, it } from 'vitest'
import { brandToInsert } from '../brands'

describe('brandToInsert', () => {
  it('maps a curated brand to an approved community insert row', () => {
    const row = brandToInsert({
      name: 'Test Maker',
      slug: 'test-maker',
      description: 'A founder-curated Made-in-Taiwan brand with a valid public profile.',
      status: 'approved',
      category: 'food',
      logoUrl: 'https://example.com/logo.png',
      productPhotos: ['https://example.com/product-1.png'],
      purchaseLinks: [
        {
          platform: 'official',
          url: 'https://example.com/shop',
          label: 'Official Store',
        },
      ],
      socialLinks: {
        instagram: 'https://instagram.com/testmaker',
        threads: '',
        facebook: '',
        officialWebsite: 'https://example.com',
      },
      retailLocations: [],
      brandHighlights: 'Community-seeded brand profile.',
    })

    expect(row.status).toBe('approved')
    expect(row).not.toHaveProperty('owner_id')
  })
})
