import { describe, expect, it } from 'vitest'
import { brandToInsert } from '../brands'

describe('brandToInsert', () => {
  it('maps a curated brand to an approved community insert row', () => {
    const row = brandToInsert({
      name: 'Test Maker',
      slug: 'test-maker',
      description:
        'A team-curated Made-in-Taiwan brand with a valid public profile.',
      status: 'approved',
      category: 'food',
      mitStory: null,
      productPhotos: ['https://example.com/product-1.png'],
      purchaseWebsite: 'https://example.com/shop',
      socialInstagram: 'https://instagram.com/testmaker',
      socialThreads: null,
      socialFacebook: null,
      otherUrls: [],
    })

    expect(row.status).toBe('approved')
    expect(row).not.toHaveProperty('owner_id')
  })
})
