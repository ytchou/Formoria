import { describe, it, expect } from 'vitest'
import { buildAlternates } from '../alternates'

const base = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '')

describe('buildAlternates', () => {
  describe("path '/brands' locale 'en'", () => {
    const result = buildAlternates('/brands', 'en')

    it('canonical is the en self URL', () => {
      expect(result.canonical).toBe(`${base}/en/brands`)
    })

    it('languages.zh-TW is prefix-free', () => {
      expect(result.languages['zh-TW']).toBe(`${base}/brands`)
    })

    it('languages.en has /en prefix', () => {
      expect(result.languages['en']).toBe(`${base}/en/brands`)
    })

    it('x-default equals zh-TW URL', () => {
      expect(result.languages['x-default']).toBe(`${base}/brands`)
    })
  })

  describe("path '/brands' locale 'zh-TW'", () => {
    const result = buildAlternates('/brands', 'zh-TW')

    it('canonical is the zh-TW self URL (prefix-free)', () => {
      expect(result.canonical).toBe(`${base}/brands`)
    })

    it('languages.zh-TW is prefix-free', () => {
      expect(result.languages['zh-TW']).toBe(`${base}/brands`)
    })

    it('languages.en has /en prefix', () => {
      expect(result.languages['en']).toBe(`${base}/en/brands`)
    })

    it('x-default equals zh-TW URL', () => {
      expect(result.languages['x-default']).toBe(`${base}/brands`)
    })
  })

  describe('home path normalization', () => {
    it("empty string produces base URL without trailing slash for zh-TW", () => {
      const result = buildAlternates('', 'zh-TW')
      expect(result.canonical).toBe(base)
      expect(result.languages['zh-TW']).toBe(base)
      expect(result.languages['en']).toBe(`${base}/en`)
    })

    it("'/' produces base URL without trailing slash for zh-TW", () => {
      const result = buildAlternates('/', 'zh-TW')
      expect(result.canonical).toBe(base)
      expect(result.languages['zh-TW']).toBe(base)
      expect(result.languages['en']).toBe(`${base}/en`)
    })

    it("'/' for locale 'en' canonical is /en", () => {
      const result = buildAlternates('/', 'en')
      expect(result.canonical).toBe(`${base}/en`)
    })
  })

  describe('nested paths', () => {
    it('brand slug path works correctly', () => {
      const result = buildAlternates('/brands/acme', 'zh-TW')
      expect(result.canonical).toBe(`${base}/brands/acme`)
      expect(result.languages['en']).toBe(`${base}/en/brands/acme`)
    })

    it('uses the lowercase percent encoding served by Next for CJK slugs', () => {
      const result = buildAlternates('/brands/阿媽牌生鐵鍋', 'zh-TW')

      expect(result.canonical).toBe(
        `${base}/brands/%e9%98%bf%e5%aa%bd%e7%89%8c%e7%94%9f%e9%90%b5%e9%8d%8b`,
      )
      expect(result.languages.en).toBe(
        `${base}/en/brands/%e9%98%bf%e5%aa%bd%e7%89%8c%e7%94%9f%e9%90%b5%e9%8d%8b`,
      )
    })
  })

  it('omits unavailable locales while preserving a self-canonical', () => {
    const zh = buildAlternates('/brands/acme', 'zh-TW', ['zh-TW'])
    const en = buildAlternates('/brands/acme', 'en', ['zh-TW'])

    expect(zh.languages).toEqual({
      'zh-TW': `${base}/brands/acme`,
      'x-default': `${base}/brands/acme`,
    })
    expect(en.canonical).toBe(`${base}/en/brands/acme`)
    expect(en.languages.en).toBeUndefined()
  })

  it('does not advertise a fallback locale when no locale is indexable', () => {
    const result = buildAlternates('/brands/incomplete', 'zh-TW', [])

    expect(result.languages).toEqual({})
  })
})
