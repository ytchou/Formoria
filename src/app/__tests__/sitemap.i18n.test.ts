import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/services/brands', () => ({
  getAllBrandSlugs: vi.fn().mockResolvedValue(['cha-zi-tang', 'daylily']),
}))

import sitemap from '../sitemap'

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

describe('sitemap i18n alternates', () => {
  it('every entry has alternates.languages with zh-TW and en', async () => {
    const entries = await sitemap()

    for (const entry of entries) {
      expect(entry.alternates?.languages?.['zh-TW']).toBeDefined()
      expect(entry.alternates?.languages?.['en']).toBeDefined()
    }
  })

  it('home entry has correct zh-TW (prefix-free) and en (/en-prefixed) URLs', async () => {
    const entries = await sitemap()
    const home = entries.find((e) => e.url === BASE)

    expect(home).toBeDefined()
    expect(home?.alternates?.languages?.['zh-TW']).toBe(BASE)
    expect(home?.alternates?.languages?.['en']).toBe(`${BASE}/en`)
  })

  it('/brands entry has correct alternates', async () => {
    const entries = await sitemap()
    const brands = entries.find((e) => e.url === `${BASE}/brands`)

    expect(brands).toBeDefined()
    expect(brands?.alternates?.languages?.['zh-TW']).toBe(`${BASE}/brands`)
    expect(brands?.alternates?.languages?.['en']).toBe(`${BASE}/en/brands`)
  })

  it('brand slug entries include alternates for both locales', async () => {
    const entries = await sitemap()
    const brand = entries.find((e) => e.url.includes('/brands/cha-zi-tang'))

    expect(brand).toBeDefined()
    expect(brand?.alternates?.languages?.['zh-TW']).toBe(`${BASE}/brands/cha-zi-tang`)
    expect(brand?.alternates?.languages?.['en']).toBe(`${BASE}/en/brands/cha-zi-tang`)
  })

  it('does not emit category entries', async () => {
    const entries = await sitemap()
    const category = entries.find((e) => e.url.includes('/brands?category=food'))

    expect(category).toBeUndefined()
  })

  it('no entry url contains operator/admin/auth/api routes', async () => {
    const entries = await sitemap()
    const forbidden = ['/admin', '/submit', '/auth', '/api']

    for (const entry of entries) {
      for (const path of forbidden) {
        expect(entry.url).not.toContain(path)
      }
    }
  })
})
