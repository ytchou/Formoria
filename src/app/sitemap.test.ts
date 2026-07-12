import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/services/brands', () => ({
  getAllBrandSlugs: vi.fn().mockResolvedValue(['cha-zi-tang', 'daylily', 'inblooom']),
}))

vi.mock('@/lib/services/guides', () => ({
  getAllGuides: vi.fn().mockResolvedValue([
    {
      slug: 'taiwan-skincare-brands',
      frontmatter: {
        title: 'Taiwan Skincare Brands',
        description: 'Test',
        slug: 'taiwan-skincare-brands',
        category: 'beauty',
        locale: 'zh-TW',
        publishedAt: '2026-06-15T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
        draft: false,
        sources: [],
        faq: [],
      },
    },
  ]),
}))

import sitemap from './sitemap'

describe('sitemap', () => {
  it('returns sitemap entries for static pages and brands', async () => {
    const entries = await sitemap()

    const urls = entries.map((e) => e.url)

    expect(urls).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/cha-zi-tang'),
        expect.stringContaining('/daylily'),
        expect.stringContaining('/inblooom'),
      ])
    )
    expect(urls).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/brands?category=fashion'),
        expect.stringContaining('/brands?category=outdoor'),
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

    expect(brandEntry?.changeFrequency).toBe('weekly')
    expect(brandEntry?.priority).toBe(0.8)
  })

  it('includes guide urls', async () => {
    const entries = await sitemap()
    const guideEntries = entries.filter((entry) => entry.url.includes('/guides/'))

    expect(guideEntries.length).toBeGreaterThanOrEqual(0)

    guideEntries.forEach((entry) => {
      expect(entry.url).toContain('/guides/')
      expect(entry.url).not.toContain('/zh-TW/guides/')
      expect(entry.lastModified).toBeDefined()
    })
  })

  it('includes guides listing, getting-started, and submit pages', async () => {
    const entries = await sitemap()
    const urls = entries.map((e) => e.url)

    expect(urls).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/guides'),
        expect.stringContaining('/getting-started'),
        expect.stringContaining('/submit'),
      ])
    )
  })

  it('includes all 12 category filter pages', async () => {
    const entries = await sitemap()
    const categoryUrls = entries.filter((e) => e.url.includes('/brands?category='))

    expect(categoryUrls).toHaveLength(12)
    categoryUrls.forEach((entry) => {
      expect(entry.changeFrequency).toBe('weekly')
      expect(entry.priority).toBe(0.8)
    })
  })
})
