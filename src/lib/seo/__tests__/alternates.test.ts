import { describe, it, expect } from 'vitest'
import { routes } from '@/lib/routes'
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

    it('uses the upper-case percent encoding internal links use for CJK slugs', () => {
      const result = buildAlternates('/brands/阿媽牌生鐵鍋', 'zh-TW')

      expect(result.canonical).toBe(
        `${base}/brands/%E9%98%BF%E5%AA%BD%E7%89%8C%E7%94%9F%E9%90%B5%E9%8D%8B`,
      )
      expect(result.languages.en).toBe(
        `${base}/en/brands/%E9%98%BF%E5%AA%BD%E7%89%8C%E7%94%9F%E9%90%B5%E9%8D%8B`,
      )
    })

    it('does not escape a path that arrives already encoded', () => {
      // `@/lib/routes` escapes each parameter once. Escaping the result again
      // turns `%E9` into `%25E9`, a canonical that resolves to nothing.
      const result = buildAlternates(routes.brand('阿媽牌生鐵鍋'), 'zh-TW')

      expect(result.canonical).toBe(
        `${base}/brands/%E9%98%BF%E5%AA%BD%E7%89%8C%E7%94%9F%E9%90%B5%E9%8D%8B`,
      )
      expect(result.canonical).not.toContain('%25')
    })

    it('canonicalizes a CJK slug to exactly the URL `routes` links to', () => {
      // Raw, pre-encoded upper-case and pre-encoded lower-case input must all
      // land on the byte-identical URL every internal link and request uses.
      const linked = `${base}${routes.brand('聲')}`
      expect(linked).toBe(`${base}/brands/%E8%81%B2`)

      for (const path of ['/brands/聲', '/brands/%E8%81%B2', '/brands/%e8%81%b2']) {
        expect(buildAlternates(path, 'zh-TW').canonical).toBe(linked)
      }
    })
  })

  // Note what the `en` half of this says: `availableLocales` shapes ONLY the
  // `languages` map. The canonical comes from the `locale` argument alone, so a
  // page with no English edition is NOT folded onto the zh-TW URL by narrowing
  // this list — it self-canonicalizes to `/en` while advertising an hreflang
  // cluster with no self-reference. Call sites that want the fold must pass
  // 'zh-TW' as the *locale* (see `/stories/[slug]` and `/events/[slug]`).
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
