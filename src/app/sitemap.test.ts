import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/services/brands', () => ({
  getBrandSeoEntries: vi.fn().mockResolvedValue([
    {
      slug: 'fully-localized',
      updatedAt: '2026-07-10T00:00:00.000Z',
      productType: 'fashion',
      description: '完整的中文品牌介紹。',
      descriptionEn: 'A complete English brand description.',
      blurbEn: 'A concise English summary.',
    },
    {
      slug: 'chinese-only',
      updatedAt: '2026-07-11T00:00:00.000Z',
      productType: 'outdoor',
      description: '只有中文內容的品牌介紹。',
      descriptionEn: null,
      blurbEn: null,
    },
    {
      slug: '阿媽牌生鐵鍋',
      updatedAt: '2026-07-12T00:00:00.000Z',
      productType: 'home-living',
      description: '台灣在地鑄鐵鍋品牌介紹。',
      descriptionEn: 'A Taiwanese cast-iron cookware brand with a complete English introduction.',
      blurbEn: 'Taiwanese cast-iron cookware.',
    },
  ]),
}))

vi.mock('@/lib/services/guides', () => ({
  getAllGuides: vi.fn().mockResolvedValue({
    ok: true,
    guides: [
      {
        slug: 'taiwan-skincare-brands',
        frontmatter: {
          title: '台灣保養品牌',
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
    ],
  }),
}))

import sitemap from './sitemap'

function pathname(entry: Awaited<ReturnType<typeof sitemap>>[number]) {
  const url = new URL(entry.url)
  return `${url.pathname}${url.search}`
}

describe('sitemap', () => {
  it('emits reciprocal URL entries for every eligible brand locale', async () => {
    const entries = await sitemap()
    const urls = entries.map(pathname)

    expect(urls).toContain('/brands/fully-localized')
    expect(urls).toContain('/en/brands/fully-localized')
    expect(urls).toContain('/brands/chinese-only')
    expect(urls).not.toContain('/en/brands/chinese-only')

    const localized = entries.filter((entry) => entry.url.includes('fully-localized'))
    expect(localized).toHaveLength(2)
    localized.forEach((entry) => {
      expect(entry.alternates?.languages).toMatchObject({
        'zh-TW': expect.stringContaining('/brands/fully-localized'),
        en: expect.stringContaining('/en/brands/fully-localized'),
      })
    })
  })

  it('uses brand update dates and omits invented ranking hints', async () => {
    const entries = await sitemap()
    const brandEntry = entries.find((entry) => pathname(entry) === '/brands/fully-localized')
    const homeEntry = entries.find((entry) => pathname(entry) === '/')

    expect(brandEntry?.lastModified).toEqual(new Date('2026-07-10T00:00:00.000Z'))
    expect(brandEntry?.changeFrequency).toBeUndefined()
    expect(brandEntry?.priority).toBeUndefined()
    expect(homeEntry?.lastModified).toBeUndefined()
  })

  it('emits CJK slug URLs in the exact encoding served without a redirect', async () => {
    const cjkEntries = (await sitemap()).filter((entry) =>
      decodeURIComponent(entry.url).includes('阿媽牌生鐵鍋'),
    )

    expect(cjkEntries).toHaveLength(2)
    cjkEntries.forEach((entry) => {
      expect(entry.url).toContain('%e9%98%bf%e5%aa%bd')
      const escapes = entry.url.match(/%[0-9a-f]{2}/gi) ?? []
      expect(escapes.every((escape) => escape === escape.toLowerCase())).toBe(true)
    })
  })

  it('emits both locale variants for category discovery pages', async () => {
    const urls = (await sitemap()).map(pathname)

    expect(urls).toContain('/brands?category=fashion')
    expect(urls).toContain('/en/brands?category=fashion')
  })

  it('only emits the authored locale for guide detail pages', async () => {
    const entries = await sitemap()
    const guideEntries = entries.filter((entry) => entry.url.includes('/guides/taiwan-skincare-brands'))

    expect(guideEntries.map(pathname)).toEqual(['/guides/taiwan-skincare-brands'])
    expect(guideEntries[0]?.lastModified).toEqual(new Date('2026-07-01T00:00:00.000Z'))
    expect(guideEntries[0]?.alternates?.languages).not.toHaveProperty('en')
  })
})
