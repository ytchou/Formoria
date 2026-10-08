import { describe, expect, it, vi } from 'vitest'

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(
    async ({ locale, namespace }: { locale: string; namespace: string }) =>
      (key: string) => `${locale}:${namespace}.${key}`,
  ),
}))

import { buildNotFoundMetadata } from '../not-found-metadata'

describe('buildNotFoundMetadata', () => {
  it('titles the page in the requested locale and keeps it out of the index', async () => {
    const metadata = await buildNotFoundMetadata('en')

    expect(metadata.title).toBe('en:errors.notFound.title')
    expect(metadata.robots).toEqual({ index: false, follow: true })
  })

  it('suppresses the canonical and hreflang a parent layout would otherwise contribute', async () => {
    const metadata = await buildNotFoundMetadata('en')

    expect(metadata.alternates).toEqual({ canonical: null, languages: {} })
  })

  it('falls back to zh-TW for a missing or unknown locale', async () => {
    expect((await buildNotFoundMetadata(undefined)).title).toBe(
      'zh-TW:errors.notFound.title',
    )
    expect((await buildNotFoundMetadata('fr')).title).toBe(
      'zh-TW:errors.notFound.title',
    )
  })
})
