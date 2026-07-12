import { describe, expect, it, vi } from 'vitest'

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) =>
    key === 'metaTitle' ? 'Taiwan Brand Guides' : 'Guides description'
  ),
  setRequestLocale: vi.fn(),
}))

vi.mock('@/lib/seo/alternates', () => ({
  buildAlternates: vi.fn(() => ({
    canonical: 'https://formoria.com/en/guides',
    languages: {
      'zh-TW': 'https://formoria.com/guides',
      en: 'https://formoria.com/en/guides',
      'x-default': 'https://formoria.com/guides',
    },
  })),
}))

vi.mock('@/lib/services/guides', () => ({
  getAllGuides: vi.fn(async () => []),
  getGuidesByCategory: vi.fn(async () => []),
}))

import { buildAlternates } from '@/lib/seo/alternates'
import { generateMetadata } from './page'

describe('guides hub metadata', () => {
  it('uses the guides path for canonical and hreflang URLs', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    })

    expect(buildAlternates).toHaveBeenCalledWith('/guides', 'en')
    expect(metadata.alternates).toEqual({
      canonical: 'https://formoria.com/en/guides',
      languages: {
        'zh-TW': 'https://formoria.com/guides',
        en: 'https://formoria.com/en/guides',
        'x-default': 'https://formoria.com/guides',
      },
    })
  })
})
