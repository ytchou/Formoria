import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildOpenGraph } from '../open-graph'

describe('buildOpenGraph', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('gives a static page an absolute PNG card on both social networks', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://formoria.com/')

    const metadata = buildOpenGraph({
      title: 'About Formoria',
      description: 'Learn how Formoria supports Taiwanese brands.',
      url: 'https://formoria.com/about',
      locale: 'en_US',
      alternateLocale: ['zh_TW'],
    })

    const image = {
      url: 'https://formoria.com/opengraph-image',
      alt: 'Formoria',
      type: 'image/png',
      width: 1200,
      height: 630,
    }

    expect(metadata.openGraph).toMatchObject({
      title: 'About Formoria',
      url: 'https://formoria.com/about',
      images: [image],
    })
    expect(metadata.twitter).toMatchObject({
      card: 'summary_large_image',
      title: 'About Formoria',
      images: [image],
    })
  })
})
