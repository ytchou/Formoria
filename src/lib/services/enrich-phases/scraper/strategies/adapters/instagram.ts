import {
  emptyResult,
  extractGalleryImages,
  extractJsonLd,
  extractPurchaseLinks,
  extractSocialLinks,
  filterHeroImage,
  hostMatches,
  metaContent,
  toImageSources,
  type GalleryImageOptions,
} from '../../parse/extractors'
import * as cheerio from 'cheerio'
import type { PlatformAdapter } from './types'

// Instagram renders Reels and video posts as poster-frame <img> tags whose URL
// is indistinguishable from a photo's; the only marker is an overlay element
// carrying one of these aria-labels.
const VIDEO_OVERLAY_LABEL_RE = /reel|clip|video/i

/**
 * Best-effort video exclusion. This selector WILL rot — Instagram's markup is
 * generated and unversioned. It is written so that rot is harmless: when
 * nothing matches, nothing is skipped and every image is kept. Never invert
 * this into a "keep only what matches" test, which would silently drop the
 * whole gallery on the next markup change.
 */
const skipVideoPosterFrames: NonNullable<GalleryImageOptions['skip']> = (el, $) => {
  const inAnchor = $(el).closest('a').find('[aria-label]').toArray()
  const labelled = inAnchor.length > 0 ? inAnchor : $(el).parent().find('[aria-label]').toArray()

  return labelled.some((node) =>
    VIDEO_OVERLAY_LABEL_RE.test($(node).attr('aria-label') ?? '')
  )
}

// Adapter images are free — no API credit is spent — and measure higher quality
// than search results, so a wider pool just gives the ranker more to choose
// from. MAX_BRAND_ACTIVE_IMAGES downstream is the cap that actually binds.
const INSTAGRAM_GALLERY_LIMIT = 20

function cleanInstagramTitle(title: string | null): string | null {
  if (!title) return null

  const withoutSuffix = title.replace(/\s*•\s*Instagram.*$/i, '').trim()
  const usernameMatch = withoutSuffix.match(/^@?([A-Za-z0-9._]+)$/)

  return usernameMatch?.[1] ?? withoutSuffix
}

export const instagramAdapter: PlatformAdapter = {
  host: 'instagram.com',
  matches: (url) => hostMatches(url, 'instagram.com'),
  parse(html, url) {
    const $ = cheerio.load(html)
    const result = emptyResult(url)
    const rawJsonLd = extractJsonLd($)
    const galleryImageUrls = extractGalleryImages($, url, {
      limit: INSTAGRAM_GALLERY_LIMIT,
      skip: skipVideoPosterFrames,
    })
    const { socialThreads, socialFacebook } = extractSocialLinks($)
    const purchaseLinks = extractPurchaseLinks($)
    const heroCandidate =
      metaContent($, 'meta[property="og:image"]') ||
      metaContent($, 'meta[name="twitter:image"]')

    return {
      ...result,
      brandName: cleanInstagramTitle(metaContent($, 'meta[property="og:title"]')),
      description:
        metaContent($, 'meta[property="og:description"]') ||
        metaContent($, 'meta[name="description"]'),
      heroImageUrl: heroCandidate
        ? filterHeroImage(heroCandidate, url) ?? galleryImageUrls[0] ?? null
        : galleryImageUrls[0] ?? null,
      galleryImageUrls,
      imageSources: toImageSources(galleryImageUrls, 'instagram_adapter', url),
      socialInstagram: url,
      socialThreads,
      socialFacebook,
      ...purchaseLinks,
      rawJsonLd,
    }
  },
}
