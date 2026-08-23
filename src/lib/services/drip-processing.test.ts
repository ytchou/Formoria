import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DRIP_TYPES, normalizeOwnerRow } from './drip-processing'

// The cron route dispatches exactly DRIP_TYPES, so an entry removed from this
// list is an entry that never sends.
it('keeps the profile_nudge drip paused (DEV-1279)', () => {
  expect(DRIP_TYPES.map((drip) => drip.key)).toEqual([
    'welcome',
    'microsite_spotlight',
    're_engagement',
  ])
})


describe('drip image URLs (DEV-1551 task 9)', () => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://formoria.test'
  })

  afterEach(() => {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
    else process.env.NEXT_PUBLIC_SITE_URL = previous
  })

  /**
   * An email is read in a client with no origin, so the relative `/i/<key>`
   * every page renders is a broken image in an inbox. This is one of only two
   * consumers allowed to absolutise.
   */
  it('carries an absolute image URL for the hero and every product photo', () => {
    const row = normalizeOwnerRow({
      user_id: 'user-1',
      brands: {
        name: 'Test Brand',
        slug: 'test-brand',
        hero_image_storage_path: 'brands/brand-1/hero.webp',
        brand_images: [
          {
            storage_path: 'brands/brand-1/hero.webp',
            status: 'active',
            sort_order: 0,
          },
          {
            storage_path: 'brands/brand-1/product.webp',
            status: 'active',
            sort_order: 1,
          },
        ],
      },
      owner_email_preferences: { unsubscribe_token: 'token-1' },
      email: 'owner@example.com',
    })

    expect(row.hero_image_url).toBe(
      'https://formoria.test/i/brands/brand-1/hero.webp',
    )
    expect(row.product_photos).toEqual([
      'https://formoria.test/i/brands/brand-1/product.webp',
    ])
    for (const url of [row.hero_image_url, ...row.product_photos]) {
      expect(url?.startsWith('https://')).toBe(true)
    }
  })

  it('omits the hero when the brand has no stored object', () => {
    const row = normalizeOwnerRow({
      user_id: 'user-2',
      brands: { name: 'No Image', slug: 'no-image', brand_images: [] },
      owner_email_preferences: { unsubscribe_token: 'token-2' },
      email: 'owner2@example.com',
    })

    expect(row.hero_image_url).toBeUndefined()
    expect(row.product_photos).toEqual([])
  })
})
