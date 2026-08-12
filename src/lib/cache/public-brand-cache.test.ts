import { beforeEach, describe, expect, it, vi } from 'vitest'

const { revalidatePath, revalidateTag } = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath, revalidateTag }))

import { routing } from '@/i18n/routing'
import {
  PUBLIC_BRAND_DATA_TAG,
  revalidatePublicBrands,
  revalidatePublicEvents,
  revalidatePublicStockists,
} from './public-brand-cache'

const revalidatedPaths = () => revalidatePath.mock.calls

describe('revalidatePublicBrands', () => {
  beforeEach(() => vi.clearAllMocks())

  it('invalidates all brand-dependent cached page families once per batch', () => {
    revalidatePublicBrands(['niizo', 'kiln'])

    expect(revalidateTag).toHaveBeenCalledTimes(1)
    expect(revalidateTag).toHaveBeenCalledWith(PUBLIC_BRAND_DATA_TAG, 'max')
    expect(revalidatedPaths()).toEqual(
      expect.arrayContaining([
        ['/zh-TW/brands/niizo'],
        ['/en/brands/niizo'],
        ['/site/niizo'],
        ['/zh-TW/brands/kiln'],
        ['/en/brands/kiln'],
        ['/site/kiln'],
        ['/zh-TW'],
        ['/en'],
        ['/zh-TW/about'],
        ['/en/about'],
        ['/zh-TW/events'],
        ['/en/events'],
        ['/sitemap.xml'],
        ['/[locale]/events/[slug]', 'page'],
        ['/[locale]/stories/[slug]', 'page'],
      ]),
    )
  })

  it('deduplicates slugs and never invalidates dynamic directory or taxonomy paths', () => {
    revalidatePublicBrands(['niizo', ' niizo ', 'kiln', ''])

    expect(
      revalidatedPaths().filter(([path]) => path === '/zh-TW/brands/niizo'),
    ).toHaveLength(1)
    expect(revalidatedPaths().filter(([path]) => path === '/site/niizo')).toHaveLength(1)
    expect(revalidatedPaths()).not.toContainEqual(['/zh-TW/brands'])
    expect(revalidatedPaths()).not.toContainEqual(['/en/brands'])
    expect(
      revalidatedPaths().some(
        ([path]) => typeof path === 'string' && path.startsWith('/categories/'),
      ),
    ).toBe(false)
  })

  it('emits one localized detail path per configured locale', () => {
    revalidatePublicBrands(['niizo'])

    expect(
      revalidatedPaths().filter(([path]) =>
        typeof path === 'string' && path.endsWith('/brands/niizo'),
      ),
    ).toEqual(routing.locales.map((locale) => [`/${locale}/brands/niizo`]))
  })

  it('does nothing for an empty brand batch', () => {
    revalidatePublicBrands([])

    expect(revalidateTag).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('revalidatePublicEvents', () => {
  beforeEach(() => vi.clearAllMocks())

  it('invalidates the event hub, sitemap, and each unique localized detail page', () => {
    revalidatePublicEvents([
      'taipei-design-market-2026',
      ' taipei-design-market-2026 ',
      'spring-craft-fair',
    ])

    expect(revalidatedPaths()).toEqual(
      expect.arrayContaining([
        ['/zh-TW/events'],
        ['/en/events'],
        ['/zh-TW/events/taipei-design-market-2026'],
        ['/en/events/taipei-design-market-2026'],
        ['/zh-TW/events/spring-craft-fair'],
        ['/en/events/spring-craft-fair'],
        ['/sitemap.xml'],
      ]),
    )
    expect(
      revalidatedPaths().filter(
        ([path]) => path === '/zh-TW/events/taipei-design-market-2026',
      ),
    ).toHaveLength(1)
  })

  it('keeps the hub and sitemap fresh when no event slug is known', () => {
    revalidatePublicEvents([])

    expect(revalidatedPaths()).toEqual([
      ...routing.locales.map((locale) => [`/${locale}/events`]),
      ['/sitemap.xml'],
    ])
  })
})

describe('revalidatePublicStockists', () => {
  beforeEach(() => vi.clearAllMocks())

  it('revalidates the index and the affected city', () => {
    revalidatePublicStockists('new_taipei')
    expect(revalidatedPaths()).toEqual([
      ['/zh-TW/where-to-buy'],
      ['/en/where-to-buy'],
      ['/zh-TW/where-to-buy/new-taipei'],
      ['/en/where-to-buy/new-taipei'],
    ])
  })

  it('emits one path per configured locale', () => {
    revalidatePublicStockists('taipei')
    expect(
      revalidatedPaths().filter(([path]) =>
        path.endsWith('/where-to-buy/taipei'),
      ),
    ).toHaveLength(routing.locales.length)
  })

  it('never emits unprefixed paths', () => {
    revalidatePublicStockists('taipei')
    expect(revalidatedPaths()).not.toContainEqual(['/where-to-buy'])
    expect(revalidatedPaths()).not.toContainEqual(['/where-to-buy/taipei'])
  })

  it('revalidates only the index when the channel has no city', () => {
    revalidatePublicStockists(null)
    expect(revalidatedPaths()).toEqual([
      ['/zh-TW/where-to-buy'],
      ['/en/where-to-buy'],
    ])
  })
})
