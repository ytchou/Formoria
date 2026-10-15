import { describe, expect, it, vi } from 'vitest'

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => `t:${key}`),
  setRequestLocale: vi.fn(),
}))
vi.mock('@/components/submit/SubmitForm', () => ({ default: () => null }))

import type { Metadata } from 'next'
import { getSiteUrl } from '@/lib/seo/site-url'
import { generateMetadata as aboutMetadata } from '../about/page'
import { generateMetadata as joinMetadata } from '../brands/join/page'
import { generateMetadata as contactMetadata } from '../contact/page'
import { generateMetadata as faqMetadata } from '../faq/page'
import { generateMetadata as privacyMetadata } from '../privacy/page'
import { generateMetadata as recommendMetadata } from '../submit/recommend/page'
import { generateMetadata as termsMetadata } from '../terms/page'

type MetadataFn = (props: {
  params: Promise<{ locale: string }>
}) => Promise<Metadata>

// The head these pages emit, not just what the builder returns: an openGraph
// object without images replaces the layout's and drops the site card.
const PAGES: Array<[name: string, path: string, generate: MetadataFn]> = [
  ['about', '/about', aboutMetadata],
  ['brands/join', '/brands/join', joinMetadata],
  ['contact', '/contact', contactMetadata],
  ['faq', '/faq', faqMetadata],
  ['privacy', '/privacy', privacyMetadata],
  ['submit/recommend', '/submit/recommend', recommendMetadata],
  ['terms', '/terms', termsMetadata],
]

const LOCALES = [
  { locale: 'zh-TW', prefix: '', ogLocale: 'zh_TW', ogAlternate: 'en_US' },
  { locale: 'en', prefix: '/en', ogLocale: 'en_US', ogAlternate: 'zh_TW' },
] as const

describe('simple page metadata', () => {
  for (const [name, path, generate] of PAGES) {
    for (const { locale, prefix, ogLocale, ogAlternate } of LOCALES) {
      it(`${name} (${locale}) carries the social card, canonical and og locale pair`, async () => {
        const metadata = await generate({ params: Promise.resolve({ locale }) })
        const canonical = `${getSiteUrl()}${prefix}${path}`

        expect(metadata.title).toBe('t:' + (name === 'brands/join' ? 'metaTitle' : 'title'))
        expect(metadata.alternates?.canonical).toBe(canonical)
        expect(metadata.openGraph).toMatchObject({
          siteName: 'Formoria',
          url: canonical,
          locale: ogLocale,
          alternateLocale: [ogAlternate],
        })
        expect(metadata.openGraph?.images).toEqual([
          expect.objectContaining({ url: `${getSiteUrl()}/opengraph-image` }),
        ])
        expect(metadata.twitter).toMatchObject({ card: 'summary_large_image' })
        expect(metadata.twitter?.images).toEqual([
          expect.objectContaining({ url: `${getSiteUrl()}/opengraph-image` }),
        ])
      })
    }
  }
})
