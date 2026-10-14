import type { Metadata } from 'next'
import { buildAlternates, type Locale } from './alternates'
import { buildOpenGraph, type OpenGraphImage } from './open-graph'

export type OgLocale = 'zh_TW' | 'en_US'

/** Normalise a raw route locale: `en` stays `en`, anything else is `zh-TW`. */
export function toSafeLocale(locale: string): Locale {
  return locale === 'en' ? 'en' : 'zh-TW'
}

/** The og:locale for a page and the og:locale:alternate of its other edition. */
export function ogLocalePair(locale: Locale): {
  locale: OgLocale
  alternateLocale: OgLocale
} {
  return locale === 'en'
    ? { locale: 'en_US', alternateLocale: 'zh_TW' }
    : { locale: 'zh_TW', alternateLocale: 'en_US' }
}

export type PageMetadataOptions = {
  /** Raw route locale; normalised with `toSafeLocale`. */
  locale: string
  title: string
  description: string
  /** Emit `title: { absolute }` so the layout's title template is skipped. */
  absoluteTitle?: boolean
  /** Prefix-free public path; builds canonical + hreflang via `buildAlternates`. */
  path?: string
  /**
   * Precomputed alternates, used when `path` is absent. Only defined keys are
   * emitted, so `{}` stays `{}`.
   */
  alternates?: { canonical?: string; languages?: Record<string, string> }
  /** Locales this page exists in. The other locale missing omits og:locale:alternate. */
  availableLocales?: readonly Locale[]
  /** Emitted only when defined. */
  robots?: Metadata['robots']
  /**
   * Replaces the default site card on og:image and twitter:image. A function
   * receives the page's canonical URL, for cards served under the page itself.
   */
  image?: OpenGraphImage | ((canonical: string) => OpenGraphImage)
}

const ALL_LOCALES: readonly Locale[] = ['zh-TW', 'en']

/**
 * The page-level `<head>` metadata shared by every public page: title,
 * description, canonical + hreflang, robots, and the Open Graph / Twitter card.
 *
 * Pure: callers resolve translations themselves and pass the strings in.
 */
export function buildPageMetadata({
  locale,
  title,
  description,
  absoluteTitle = false,
  path,
  alternates,
  availableLocales = ALL_LOCALES,
  robots,
  image,
}: PageMetadataOptions): Metadata {
  const safeLocale = toSafeLocale(locale)
  const resolvedAlternates =
    path !== undefined
      ? buildAlternates(path, safeLocale, availableLocales)
      : {
          ...(alternates?.canonical !== undefined
            ? { canonical: alternates.canonical }
            : {}),
          ...(alternates?.languages
            ? { languages: alternates.languages }
            : {}),
        }
  const canonical = resolvedAlternates.canonical

  let resolvedImage: OpenGraphImage | undefined
  if (typeof image === 'function') {
    if (canonical === undefined) {
      throw new Error('buildPageMetadata: an image function needs a canonical URL')
    }
    resolvedImage = image(canonical)
  } else {
    resolvedImage = image
  }

  const og = ogLocalePair(safeLocale)
  const otherLocale: Locale = safeLocale === 'en' ? 'zh-TW' : 'en'

  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: resolvedAlternates,
    ...(robots ? { robots } : {}),
    ...buildOpenGraph({
      title,
      description,
      url: canonical,
      locale: og.locale,
      ...(availableLocales.includes(otherLocale)
        ? { alternateLocale: [og.alternateLocale] }
        : {}),
      image: resolvedImage,
    }),
  }
}
