import { beforeEach, describe, expect, it, vi } from 'vitest'

const { revalidatePath, revalidateTag } = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath, revalidateTag }))

import { routing } from '@/i18n/routing'
import {
  PUBLIC_BRAND_DATA_TAG,
  revalidatePublicBrand,
  revalidatePublicEvent,
} from './public-brand-cache'

const revalidatedPaths = () => revalidatePath.mock.calls.map(([path]) => path)

describe('revalidatePublicBrand', () => {
  beforeEach(() => vi.clearAllMocks())

  it('invalidates every locale-prefixed variant, discovery pages, and the sitemap', () => {
    revalidatePublicBrand({ slug: 'niizo' })

    expect(revalidatedPaths()).toEqual(
      expect.arrayContaining([
        '/zh-TW/brands/niizo',
        '/en/brands/niizo',
        '/zh-TW',
        '/en',
        '/zh-TW/brands',
        '/en/brands',
        '/zh-TW/stats',
        '/en/stats',
        '/zh-TW/about',
        '/en/about',
        '/sitemap.xml',
      ]),
    )
  })

  it('invalidates the shared public brand data cache', () => {
    revalidatePublicBrand({ slug: 'niizo' })

    expect(revalidateTag).toHaveBeenCalledWith(PUBLIC_BRAND_DATA_TAG, 'max')
  })

  it('never emits unprefixed paths — `as-needed` keeps the locale in the ISR cache key', () => {
    revalidatePublicBrand({ slug: 'niizo', previousSlug: 'old-niizo' })

    expect(revalidatedPaths()).not.toContain('/brands/niizo')
    expect(revalidatedPaths()).not.toContain('/brands/old-niizo')
    expect(revalidatedPaths()).not.toContain('/brands')
    expect(revalidatedPaths()).not.toContain('/stats')
    expect(revalidatedPaths()).not.toContain('/about')
    expect(revalidatedPaths()).not.toContain('/')
  })

  it('covers the previous slug in every locale after a rename', () => {
    revalidatePublicBrand({ slug: 'niizo', previousSlug: 'old-niizo' })

    expect(revalidatedPaths()).toEqual(
      expect.arrayContaining(['/zh-TW/brands/old-niizo', '/en/brands/old-niizo']),
    )
  })

  it('skips the previous slug when it matches the current slug', () => {
    revalidatePublicBrand({ slug: 'niizo', previousSlug: 'niizo' })

    expect(
      revalidatedPaths().filter((path) => path === '/zh-TW/brands/niizo'),
    ).toHaveLength(1)
  })

  it('emits one brand path per configured locale so a new locale cannot regress', () => {
    revalidatePublicBrand({ slug: 'niizo' })

    expect(
      revalidatedPaths().filter((path) => path.endsWith('/brands/niizo')),
    ).toEqual(routing.locales.map((locale) => `/${locale}/brands/niizo`))
  })
})

describe('revalidatePublicEvent', () => {
  beforeEach(() => vi.clearAllMocks())

  it('invalidates the hub, the detail page in every locale, and the sitemap', () => {
    revalidatePublicEvent({ slug: 'taipei-design-market-2026' })

    // The sitemap now emits /events/<slug> URLs, so skipping it leaves a freshly
    // seeded event out of the served sitemap.xml for the full revalidate window.
    expect(revalidatedPaths()).toEqual(
      expect.arrayContaining([
        '/zh-TW/events',
        '/en/events',
        '/zh-TW/events/taipei-design-market-2026',
        '/en/events/taipei-design-market-2026',
        '/sitemap.xml',
      ]),
    )
  })

  it('never emits unprefixed event paths — `as-needed` keeps the locale in the ISR cache key', () => {
    revalidatePublicEvent({ slug: 'taipei-design-market-2026' })

    expect(revalidatedPaths()).not.toContain('/events')
    expect(revalidatedPaths()).not.toContain(
      '/events/taipei-design-market-2026',
    )
  })

  it('revalidates the hub and the sitemap when no slug is given', () => {
    revalidatePublicEvent()

    expect(revalidatedPaths()).toEqual([
      ...routing.locales.map((locale) => `/${locale}/events`),
      '/sitemap.xml',
    ])
  })
})
