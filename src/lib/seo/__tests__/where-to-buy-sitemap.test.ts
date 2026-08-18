import { describe, expect, it } from 'vitest'
import { CITY_SLUGS, type CitySlug } from '@/lib/constants/taiwan-cities'
import type { StockistLocation } from '@/lib/services/brand-channels'
import {
  buildWhereToBuySitemapEntries,
  buildWhereToBuySitemapSection,
} from '../where-to-buy-sitemap'

function location(city: CitySlug, index: number): StockistLocation {
  return {
    id: `location-${index}`,
    name: `María García Shop ${index}`,
    address: `No. ${index}, Market Road`,
    url: null,
    country: 'TW',
    city,
    district: null,
    brandSlug: `maria-garcia-${index}`,
    brandName: `María García ${index}`,
    productType: 'home',
    productTags: [],
  }
}

describe('where-to-buy sitemap', () => {
  it('emits the index and 21 city URLs without district URLs', () => {
    const cities = CITY_SLUGS.filter((city) => city !== 'lienchiang')
    const entries = buildWhereToBuySitemapEntries(
      cities.map((city, index) => location(city, index)),
    )
    expect(entries).toHaveLength(44)
    expect(entries.some(({ url }) => url.includes('#'))).toBe(false)
  })

  it('emits one entry per locale', () => {
    const entries = buildWhereToBuySitemapEntries([location('taipei', 1)])
    expect(entries.map(({ url }) => url)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/where-to-buy'),
        expect.stringContaining('/en/where-to-buy'),
      ]),
    )
  })

  it('degrades to an empty array on a data error', async () => {
    await expect(
      buildWhereToBuySitemapSection(Promise.reject(new Error('database unavailable'))),
    ).resolves.toEqual([])
  })
})
