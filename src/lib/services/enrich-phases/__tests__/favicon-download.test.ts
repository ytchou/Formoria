import { describe, expect, it } from 'vitest'
import {
  isAcceptedFaviconContentType,
  faviconExtFromContentType,
  isValidFaviconDimensions,
  pickLogoImage,
} from '../favicon-download'

describe('downloadAndStoreFavicon', () => {
  describe('content-type validation', () => {
    it('rejects .ico content type', () => {
      expect(isAcceptedFaviconContentType('image/x-icon')).toBe(false)
      expect(isAcceptedFaviconContentType('image/vnd.microsoft.icon')).toBe(false)
    })

    it('accepts image/png', () => {
      expect(isAcceptedFaviconContentType('image/png')).toBe(true)
      expect(faviconExtFromContentType('image/png')).toBe('png')
    })

    it('accepts image/jpeg', () => {
      expect(isAcceptedFaviconContentType('image/jpeg')).toBe(true)
      expect(faviconExtFromContentType('image/jpeg')).toBe('jpeg')
    })

    it('accepts image/webp', () => {
      expect(isAcceptedFaviconContentType('image/webp')).toBe(true)
      expect(faviconExtFromContentType('image/webp')).toBe('webp')
    })

    it('accepts image/svg+xml', () => {
      expect(isAcceptedFaviconContentType('image/svg+xml')).toBe(true)
      expect(faviconExtFromContentType('image/svg+xml')).toBe('svg')
    })

    it('rejects text/html', () => {
      expect(isAcceptedFaviconContentType('text/html')).toBe(false)
    })

    it('handles content-type with charset parameter', () => {
      expect(isAcceptedFaviconContentType('image/png; charset=utf-8')).toBe(true)
    })
  })

  describe('dimension validation', () => {
    it('rejects images below 32px', () => {
      expect(isValidFaviconDimensions(16, 16, 'png')).toBe(false)
      expect(isValidFaviconDimensions(31, 100, 'jpeg')).toBe(false)
      expect(isValidFaviconDimensions(100, 31, 'webp')).toBe(false)
    })

    it('accepts 180px PNG', () => {
      expect(isValidFaviconDimensions(180, 180, 'png')).toBe(true)
    })

    it('accepts exactly 32px', () => {
      expect(isValidFaviconDimensions(32, 32, 'png')).toBe(true)
    })

    it('skips dimension check for SVG', () => {
      // SVGs have no meaningful pixel dimensions — accept at any size
      expect(isValidFaviconDimensions(0, 0, 'svg')).toBe(true)
      expect(isValidFaviconDimensions(1, 1, 'svg')).toBe(true)
    })
  })
})

describe('syncLogoDenormalized', () => {
  it('prefers favicon tag over logo tag', () => {
    const rows = [
      { tags: ['logo'], storage_path: 'brands/b1/logo.webp' },
      { tags: ['favicon'], storage_path: 'brands/b1/favicon.png' },
    ]
    expect(pickLogoImage(rows)).toBe('brands/b1/favicon.png')
  })

  it('returns null when no logo images exist', () => {
    expect(pickLogoImage([])).toBeNull()
    expect(pickLogoImage([{ tags: ['product'], storage_path: 'brands/b1/photo.webp' }])).toBeNull()
  })

  it('returns logo when no favicon exists', () => {
    const rows = [
      { tags: ['logo'], storage_path: 'brands/b1/logo.webp' },
    ]
    expect(pickLogoImage(rows)).toBe('brands/b1/logo.webp')
  })

  it('handles null tags gracefully', () => {
    const rows = [
      { tags: null, storage_path: 'brands/b1/photo.webp' },
      { tags: ['favicon'], storage_path: 'brands/b1/favicon.png' },
    ]
    expect(pickLogoImage(rows)).toBe('brands/b1/favicon.png')
  })

  it('ignores rows with null storage_path', () => {
    const rows = [
      { tags: ['favicon'], storage_path: null },
      { tags: ['logo'], storage_path: 'brands/b1/logo.webp' },
    ]
    expect(pickLogoImage(rows)).toBe('brands/b1/logo.webp')
  })
})
