import type { Metadata } from 'next'
import { buildOpenGraph } from './open-graph'

type PrivatePageMetadataOptions = {
  locale: string
  title: string
  description: string
}

/**
 * Metadata for account surfaces (auth, favorites, settings): nothing to rank,
 * but each page names itself.
 *
 * Without its own description a page inherits the homepage's, in
 * `<meta name="description">` and in the share card. Page-level `openGraph`
 * replaces the parent's, so the card is rebuilt here with this page's text.
 * The explicit `canonical: null` and empty `languages` stop pages under
 * `(site)` from inheriting the home canonical and hreflang set.
 */
export function buildPrivatePageMetadata({
  locale,
  title,
  description,
}: PrivatePageMetadataOptions): Metadata {
  const isEn = locale === 'en'

  return {
    title,
    description,
    robots: { index: false, follow: true },
    alternates: { canonical: null, languages: {} },
    ...buildOpenGraph({
      title,
      description,
      locale: isEn ? 'en_US' : 'zh_TW',
      alternateLocale: [isEn ? 'zh_TW' : 'en_US'],
    }),
  }
}
