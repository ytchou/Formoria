import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  absoluteImageUrl,
  imagePathToUrl,
  storagePathFromImageUrl,
} from '@/lib/images/image-url'

const SITE_URL = 'https://formoria.test'

describe('imagePathToUrl', () => {
  it('builds a relative /i/ path', () => {
    expect(
      imagePathToUrl('brands/11111111-2222-3333-4444-555555555555/x.webp'),
    ).toBe('/i/brands/11111111-2222-3333-4444-555555555555/x.webp')
  })

  it('trims surrounding whitespace', () => {
    expect(imagePathToUrl('  brands/a/x.webp  ')).toBe('/i/brands/a/x.webp')
  })

  it('returns null for a blank path', () => {
    expect(imagePathToUrl(null)).toBeNull()
    expect(imagePathToUrl(undefined)).toBeNull()
    expect(imagePathToUrl('   ')).toBeNull()
  })

  it('refuses a value that is already a URL or an absolute path', () => {
    expect(imagePathToUrl('https://cdn.example/x.webp')).toBeNull()
    expect(imagePathToUrl('/i/brands/a/x.webp')).toBeNull()
  })
})

describe('absoluteImageUrl', () => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = SITE_URL
  })

  afterEach(() => {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
    else process.env.NEXT_PUBLIC_SITE_URL = previous
  })

  it('prefixes the site URL', () => {
    expect(absoluteImageUrl(imagePathToUrl('brands/a/x.webp'))).toBe(
      `${SITE_URL}/i/brands/a/x.webp`,
    )
  })

  it('leaves an already-absolute URL alone', () => {
    expect(absoluteImageUrl('https://cdn.example/x.webp')).toBe(
      'https://cdn.example/x.webp',
    )
  })

  it('returns null for a blank value', () => {
    expect(absoluteImageUrl(null)).toBeNull()
    expect(absoluteImageUrl('')).toBeNull()
  })
})

describe('storagePathFromImageUrl', () => {
  it('round-trips imagePathToUrl', () => {
    const path = 'brands/a/x.webp'
    expect(storagePathFromImageUrl(imagePathToUrl(path))).toBe(path)
  })

  it('returns null for anything that is not a proxy path', () => {
    expect(storagePathFromImageUrl('https://cdn.example/x.webp')).toBeNull()
    expect(storagePathFromImageUrl('/images/logo.png')).toBeNull()
    expect(storagePathFromImageUrl('/i/')).toBeNull()
  })
})
