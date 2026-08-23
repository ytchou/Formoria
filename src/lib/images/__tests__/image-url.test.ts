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

  it('is idempotent, because JSON-LD callers pass mixed values', () => {
    const once = absoluteImageUrl('/i/brands/a/x.webp')
    expect(absoluteImageUrl(once)).toBe(once)
  })

  it('absolutises a path with no leading slash rather than passing it on', () => {
    // A relative IRI is what Google's structured-data parser drops.
    expect(absoluteImageUrl('images/formoria-mark.png')).toBe(
      `${SITE_URL}/images/formoria-mark.png`,
    )
  })

  it('leaves a non-http scheme and a protocol-relative URL alone', () => {
    expect(absoluteImageUrl('data:image/webp;base64,AAAA')).toBe(
      'data:image/webp;base64,AAAA',
    )
    expect(absoluteImageUrl('//cdn.example/x.webp')).toBe('//cdn.example/x.webp')
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
