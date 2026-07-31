import { describe, expect, it, vi } from 'vitest'

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
  setRequestLocale: vi.fn(),
}))

import { generateMetadata } from './page'

function metadataFor(locale: string) {
  return generateMetadata({ params: Promise.resolve({ locale }) })
}

describe('feedback metadata', () => {
  it('sets noindex', async () => {
    const metadata = await metadataFor('en')

    expect(metadata.robots).toEqual({ index: false, follow: true })
  })

  it('sets canonical and alternates', async () => {
    const [en, zh] = await Promise.all([metadataFor('en'), metadataFor('zh-TW')])

    expect(en.alternates?.canonical).toMatch(/\/en\/feature-requests$/)
    // Fully anchored: a bare `/feature-requests$` suffix match would also pass
    // for the /en/ URL, so it could not catch a zh-TW canonical that leaked the
    // locale prefix.
    expect(zh.alternates?.canonical).toMatch(
      /^https?:\/\/[^/]+\/feature-requests$/,
    )
    expect(en.alternates?.languages).toMatchObject({
      en: expect.stringMatching(/\/en\/feature-requests$/),
      'zh-TW': expect.stringMatching(/^https?:\/\/[^/]+\/feature-requests$/),
      'x-default': expect.stringMatching(/^https?:\/\/[^/]+\/feature-requests$/),
    })
    expect(zh.alternates?.languages).toEqual(en.alternates?.languages)
  })
})
