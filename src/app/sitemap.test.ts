import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/services/brands', () => ({
  getAllBrandSlugs: vi.fn().mockResolvedValue(['cha-zi-tang', 'daylily', 'inblooom']),
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
    expect(urls).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining('/brands?category='),
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
})
