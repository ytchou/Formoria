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
  revalidatePublicStockists,
} from './public-brand-cache'

const revalidatedPaths = () => revalidatePath.mock.calls

describe('revalidatePublicBrands', () => {
  beforeEach(() => vi.clearAllMocks())

  it('invalidates all brand-dependent cached page families once per batch', () => {
    // Bug: an approved brand mutation must invalidate the exact prefixless
    // zh-TW detail cache, not only the localized route that next-intl rewrites.
    revalidatePublicBrands(['niizo', 'kiln'])

    expect(revalidateTag).toHaveBeenCalledTimes(1)
    expect(revalidateTag).toHaveBeenCalledWith(PUBLIC_BRAND_DATA_TAG, 'max')
    expect(revalidatedPaths()).toEqual(
      expect.arrayContaining([
        ['/brands/niizo'],
        ['/en/brands/niizo'],
        ['/brands/kiln'],
        ['/en/brands/kiln'],
        ['/zh-TW'],
        ['/en'],
        ['/zh-TW/about'],
        ['/en/about'],
        ['/sitemap.xml'],
        ['/[locale]/stories/[slug]', 'page'],
      ]),
    )
  })

  it('deduplicates slugs and never invalidates dynamic directory or taxonomy paths', () => {
    revalidatePublicBrands(['niizo', ' niizo ', 'kiln', ''])

    expect(
      revalidatedPaths().filter(([path]) => path === '/brands/niizo'),
    ).toHaveLength(1)
    expect(revalidatedPaths()).not.toContainEqual(['/zh-TW/brands'])
    expect(revalidatedPaths()).not.toContainEqual(['/en/brands'])
    expect(
      revalidatedPaths().some(
        ([path]) => typeof path === 'string' && path.startsWith('/categories/'),
      ),
    ).toBe(false)
  })

  it('emits the exact default-locale and English detail paths', () => {
    revalidatePublicBrands(['niizo'])

    expect(
      revalidatedPaths().filter(([path]) =>
        typeof path === 'string' && path.endsWith('/brands/niizo'),
      ),
    ).toEqual([['/brands/niizo'], ['/en/brands/niizo']])
    expect(revalidatedPaths()).not.toContainEqual(['/zh-TW/brands/niizo'])
  })

  it('does nothing for an empty brand batch', () => {
    revalidatePublicBrands([])

    expect(revalidateTag).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
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
