import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/services/brands', () => ({
  getAllBrandSlugs: vi.fn().mockResolvedValue(['cha-zi-tang', 'daylily', 'inblooom']),
}))

vi.mock('@/lib/services/taxonomy', () => ({
  getActiveCategories: vi.fn().mockResolvedValue([
    { slug: 'food', name: 'Food', nameZh: '食品' },
    { slug: 'beauty', name: 'Beauty', nameZh: '美妝' },
  ]),
}))

import sitemap from './sitemap'

describe('sitemap', () => {
  it('returns sitemap entries for static pages, brands, and categories', async () => {
    const entries = await sitemap()

    const urls = entries.map((e) => e.url)

    expect(urls).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/cha-zi-tang'),
        expect.stringContaining('/daylily'),
        expect.stringContaining('/inblooom'),
        expect.stringContaining('/brands?category=food'),
        expect.stringContaining('/brands?category=beauty'),
      ])
    )
  })

  it('includes lastModified dates', async () => {
    const entries = await sitemap()

    entries.forEach((entry) => {
      expect(entry.lastModified).toBeDefined()
    })
  })

  it('includes changeFrequency and priority', async () => {
    const entries = await sitemap()
    const brandEntry = entries.find((e) => e.url.includes('/cha-zi-tang'))
    const categoryEntry = entries.find((e) => e.url.includes('/brands?category=food'))

    expect(brandEntry?.changeFrequency).toBe('weekly')
    expect(categoryEntry?.changeFrequency).toBe('weekly')
    expect(categoryEntry?.priority).toBe(0.8)
  })
})
