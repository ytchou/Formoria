import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildPageMetadata,
  ogLocalePair,
  toSafeLocale,
} from '../page-metadata'

const ORIGIN = 'https://formoria.com'
const DEFAULT_IMAGE = {
  url: `${ORIGIN}/opengraph-image`,
  alt: 'Formoria',
  type: 'image/png',
  width: 1200,
  height: 630,
}

describe('toSafeLocale', () => {
  it('keeps en and maps everything else to zh-TW', () => {
    expect(toSafeLocale('en')).toBe('en')
    expect(toSafeLocale('zh-TW')).toBe('zh-TW')
    expect(toSafeLocale('fr')).toBe('zh-TW')
    expect(toSafeLocale('')).toBe('zh-TW')
  })
})

describe('ogLocalePair', () => {
  it('pairs each locale with the other edition as its alternate', () => {
    expect(ogLocalePair('zh-TW')).toEqual({
      locale: 'zh_TW',
      alternateLocale: 'en_US',
    })
    expect(ogLocalePair('en')).toEqual({
      locale: 'en_US',
      alternateLocale: 'zh_TW',
    })
  })
})

describe('buildPageMetadata', () => {
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_SITE_URL', `${ORIGIN}/`))
  afterEach(() => vi.unstubAllEnvs())

  it('builds canonical, hreflang, og:url and the og locale pair from a path', () => {
    const metadata = buildPageMetadata({
      locale: 'en',
      path: '/terms',
      title: 'Terms',
      description: 'The terms.',
    })

    expect(metadata.title).toBe('Terms')
    expect(metadata.description).toBe('The terms.')
    expect(metadata.alternates).toEqual({
      canonical: `${ORIGIN}/en/terms`,
      languages: {
        'zh-TW': `${ORIGIN}/terms`,
        en: `${ORIGIN}/en/terms`,
        'x-default': `${ORIGIN}/terms`,
      },
    })
    expect(metadata.openGraph).toMatchObject({
      siteName: 'Formoria',
      title: 'Terms',
      description: 'The terms.',
      url: `${ORIGIN}/en/terms`,
      locale: 'en_US',
      alternateLocale: ['zh_TW'],
    })
    expect(metadata.robots).toBeUndefined()
  })

  it('normalises an unknown locale to zh-TW', () => {
    const metadata = buildPageMetadata({
      locale: 'xx',
      path: '/terms',
      title: 'T',
      description: 'D',
    })

    expect(metadata.alternates?.canonical).toBe(`${ORIGIN}/terms`)
    expect(metadata.openGraph).toMatchObject({
      locale: 'zh_TW',
      alternateLocale: ['en_US'],
    })
  })

  it('emits an absolute title while og and twitter keep the plain string', () => {
    const metadata = buildPageMetadata({
      locale: 'zh-TW',
      path: '/',
      title: 'Home',
      description: 'D',
      absoluteTitle: true,
    })

    expect(metadata.title).toEqual({ absolute: 'Home' })
    expect(metadata.openGraph).toMatchObject({ title: 'Home' })
    expect(metadata.twitter).toMatchObject({ title: 'Home' })
    expect(metadata.alternates?.canonical).toBe(ORIGIN)
  })

  it('uses precomputed alternates and omits undefined languages', () => {
    const metadata = buildPageMetadata({
      locale: 'zh-TW',
      title: 'T',
      description: 'D',
      alternates: { canonical: `${ORIGIN}/brands?page=2`, languages: undefined },
    })

    expect(metadata.alternates).toEqual({ canonical: `${ORIGIN}/brands?page=2` })
    expect(metadata.alternates).not.toHaveProperty('languages')
    expect(metadata.openGraph).toMatchObject({ url: `${ORIGIN}/brands?page=2` })
  })

  it('keeps an empty alternates object empty and emits no og:url', () => {
    const metadata = buildPageMetadata({
      locale: 'en',
      title: 'T',
      description: 'D',
      alternates: {},
    })

    expect(metadata.alternates).toEqual({})
    expect(metadata.openGraph).not.toHaveProperty('url')
    expect(metadata.openGraph).toMatchObject({
      locale: 'en_US',
      alternateLocale: ['zh_TW'],
    })
  })

  it('emits robots only when given', () => {
    const metadata = buildPageMetadata({
      locale: 'en',
      path: '/x',
      title: 'T',
      description: 'D',
      robots: { index: false, follow: true },
    })

    expect(metadata.robots).toEqual({ index: false, follow: true })
  })

  it('omits og:locale:alternate and the hreflang when the other locale is unavailable', () => {
    const metadata = buildPageMetadata({
      locale: 'zh-TW',
      path: '/brands/acme',
      title: 'Acme',
      description: 'D',
      availableLocales: ['zh-TW'],
    })

    expect(metadata.openGraph).not.toHaveProperty('alternateLocale')
    expect(metadata.openGraph).toMatchObject({ locale: 'zh_TW' })
    expect(metadata.alternates?.languages).toEqual({
      'zh-TW': `${ORIGIN}/brands/acme`,
      'x-default': `${ORIGIN}/brands/acme`,
    })
  })

  // An openGraph object without images replaces the parent's and suppresses
  // the default card site-wide; every page must carry one.
  it('carries the default site card on og and twitter when no image is given', () => {
    const metadata = buildPageMetadata({
      locale: 'en',
      path: '/x',
      title: 'T',
      description: 'D',
    })

    expect(metadata.openGraph).toMatchObject({ images: [DEFAULT_IMAGE] })
    expect(metadata.twitter).toMatchObject({
      card: 'summary_large_image',
      images: [DEFAULT_IMAGE],
    })
  })

  it('applies an image override to og and twitter, including alt', () => {
    const image = {
      url: `${ORIGIN}/card.png`,
      alt: 'Acme',
      width: 1200,
      height: 630,
      type: 'image/png',
    }
    const metadata = buildPageMetadata({
      locale: 'en',
      path: '/x',
      title: 'T',
      description: 'D',
      image,
    })

    expect(metadata.openGraph).toMatchObject({ images: [image] })
    expect(metadata.twitter).toMatchObject({
      card: 'summary_large_image',
      images: [image],
    })
  })

  it('resolves an image function against the canonical URL', () => {
    const metadata = buildPageMetadata({
      locale: 'en',
      path: '/brands/acme',
      title: 'Acme',
      description: 'D',
      image: (canonical) => ({
        url: `${canonical}/opengraph-image`,
        alt: 'Acme',
        width: 1200,
        height: 630,
        type: 'image/png',
      }),
    })

    const expected = {
      url: `${ORIGIN}/en/brands/acme/opengraph-image`,
      alt: 'Acme',
      width: 1200,
      height: 630,
      type: 'image/png',
    }
    expect(metadata.openGraph).toMatchObject({ images: [expected] })
    expect(metadata.twitter).toMatchObject({ images: [expected] })
  })
})
