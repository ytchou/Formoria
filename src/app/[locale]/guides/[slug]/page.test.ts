import { beforeEach, describe, expect, it, vi } from 'vitest'

const guideServiceMocks = vi.hoisted(() => ({
  getPublishedGuideBySlug: vi.fn(),
}))

const navigationMocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  notFound: navigationMocks.notFound,
}))

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
  setRequestLocale: vi.fn(),
}))

vi.mock('@/lib/services/guides', () => ({
  getPublishedGuideBySlug: guideServiceMocks.getPublishedGuideBySlug,
}))

import { generateMetadata } from './page'

describe('guide detail metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    guideServiceMocks.getPublishedGuideBySlug.mockResolvedValue({
      entry: {
        slug: 'taiwan-home-brands',
        frontmatter: {
          title: '台灣居家品牌',
          description: '精選台灣居家品牌與在地設計作品。',
          slug: 'taiwan-home-brands',
          locale: 'zh-TW',
          publishedAt: '2026-07-01T00:00:00.000Z',
          draft: false,
          sources: [],
          faq: [],
        },
      },
      tina: {},
    })
  })

  it('does not advertise or index a locale the guide was not authored in', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ locale: 'en', slug: 'taiwan-home-brands' }),
    })

    expect(metadata.robots).toEqual({ index: false, follow: true })
    expect(metadata.alternates?.languages).toHaveProperty('zh-TW')
    expect(metadata.alternates?.languages).not.toHaveProperty('en')
  })

  it('preserves the not-found signal for unpublished guides', async () => {
    guideServiceMocks.getPublishedGuideBySlug.mockResolvedValue(null)

    await expect(
      generateMetadata({
        params: Promise.resolve({ locale: 'zh-TW', slug: 'draft-guide' }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND')
    expect(navigationMocks.notFound).toHaveBeenCalled()
  })
})
