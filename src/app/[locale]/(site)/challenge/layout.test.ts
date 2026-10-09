import { describe, expect, it, vi } from 'vitest'

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(
    async ({ locale, namespace }: { locale: string; namespace: string }) =>
      (key: string) => `${locale}:${namespace}.${key}`,
  ),
}))

import { generateMetadata } from './layout'

describe('challenge layout metadata', () => {
  it('titles the page in its locale and keeps it out of the index', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ locale: 'en' }),
    })

    expect(metadata.title).toBe('en:challenge.title')
    expect(metadata.robots).toEqual({ index: false, follow: false })
  })

  it('drops the homepage canonical and hreflang the site layout sets', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ locale: 'zh-TW' }),
    })

    expect(metadata.alternates).toEqual({ canonical: null, languages: {} })
  })

  it('falls back to zh-TW for an unknown locale', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ locale: 'fr' }),
    })

    expect(metadata.title).toBe('zh-TW:challenge.title')
  })
})
