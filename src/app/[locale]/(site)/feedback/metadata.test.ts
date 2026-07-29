import { describe, expect, it, vi } from 'vitest'

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
  setRequestLocale: vi.fn(),
}))

import { generateMetadata } from './page'

const searchParams = Promise.resolve({})

function metadataFor(locale: string) {
  return generateMetadata({ params: Promise.resolve({ locale }), searchParams })
}

describe('feedback metadata', () => {
  it('sets noindex', async () => {
    const metadata = await metadataFor('en')

    expect(metadata.robots).toEqual({ index: false, follow: true })
  })

  it('sets canonical and alternates', async () => {
    const [en, zh] = await Promise.all([metadataFor('en'), metadataFor('zh-TW')])

    expect(en.alternates?.canonical).toMatch(/\/en\/feedback$/)
    expect(zh.alternates?.canonical).toMatch(/\/feedback$/)
    expect(en.alternates?.languages).toMatchObject({
      en: expect.stringMatching(/\/en\/feedback$/),
      'zh-TW': expect.stringMatching(/\/feedback$/),
      'x-default': expect.stringMatching(/\/feedback$/),
    })
    expect(zh.alternates?.languages).toEqual(en.alternates?.languages)
  })
})
