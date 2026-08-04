import type { Metadata } from 'next'
import { getSiteUrl } from './site-url'

const DEFAULT_IMAGE_PATH = '/opengraph-image'
const DEFAULT_IMAGE_ALT = 'Formoria'
const DEFAULT_IMAGE_TYPE = 'image/png'
const DEFAULT_IMAGE_WIDTH = 1200
const DEFAULT_IMAGE_HEIGHT = 630

type OpenGraphType =
  | 'article'
  | 'book'
  | 'music.song'
  | 'music.album'
  | 'music.playlist'
  | 'music.radio_station'
  | 'profile'
  | 'website'
  | 'video.tv_show'
  | 'video.other'
  | 'video.movie'
  | 'video.episode'

export type BuildOpenGraphOptions = {
  title?: string
  description?: string
  url?: string | URL
  locale?: string
  alternateLocale?: string | readonly string[]
  type?: OpenGraphType
}

export type OpenGraphMetadata = Pick<Metadata, 'openGraph' | 'twitter'>

/**
 * Build the shared social metadata for pages that use Formoria's default card.
 *
 * Page-level `openGraph` and `twitter` objects replace their parent objects in
 * Next.js metadata merging, so every page that declares either object must
 * include the default image and Twitter card again.
 */
export function buildOpenGraph({
  title,
  description,
  url,
  locale,
  alternateLocale,
  type = 'website',
}: BuildOpenGraphOptions = {}): OpenGraphMetadata {
  const imageUrl = `${getSiteUrl()}${DEFAULT_IMAGE_PATH}`
  const image = {
    url: imageUrl,
    alt: DEFAULT_IMAGE_ALT,
    type: DEFAULT_IMAGE_TYPE,
    width: DEFAULT_IMAGE_WIDTH,
    height: DEFAULT_IMAGE_HEIGHT,
  }

  return {
    openGraph: {
      siteName: 'Formoria',
      type,
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(url ? { url } : {}),
      ...(locale ? { locale } : {}),
      ...(alternateLocale
        ? {
            alternateLocale:
              typeof alternateLocale === 'string'
                ? alternateLocale
                : [...alternateLocale],
          }
        : {}),
      images: [image],
    },
    twitter: {
      card: 'summary_large_image',
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      images: [image],
    },
  }
}
