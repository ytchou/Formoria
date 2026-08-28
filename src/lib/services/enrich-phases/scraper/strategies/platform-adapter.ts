import * as cheerio from 'cheerio'
import {
  emptyResult,
  extractAllJsonLd,
  extractJsonLdImages,
  metaContent,
  upgradeEcommerceImageUrl,
} from '../parse/extractors'
import { instagramAdapter } from './adapters/instagram'
import { myshipAdapter } from './adapters/myship'
import { pinkoiAdapter } from './adapters/pinkoi'
import { shopeeAdapter } from './adapters/shopee'
import { fetchHtml } from '../fetch-guards'
import { shoplineAdapter } from './adapters/shopline'
import { ninetyOneAppAdapter } from './adapters/ninety-one-app'
import { cyberbizAdapter } from './adapters/cyberbiz'
import { MARKETPLACE_GALLERY_LIMIT } from './adapters/create-marketplace-adapter'
import { identifyPlatform } from '../platforms'
import { extractCatalogRoutes } from '../../catalog-discovery'
import type { PlatformAdapter } from './adapters/types'
import type { ScrapedImageSource } from '@/lib/types/scraper'
import type { ScrapeContext, ScrapeStrategy } from './types'

const adapters: PlatformAdapter[] = [
  pinkoiAdapter,
  shopeeAdapter,
  myshipAdapter,
  instagramAdapter,
  shoplineAdapter,
  ninetyOneAppAdapter,
  cyberbizAdapter,
]

/** Max detail pages to fetch for 91App hydration. */
const HYDRATION_LIMIT = 5

export class PlatformAdapterStrategy implements ScrapeStrategy {
  readonly type = 'e-commerce'

  async scrape(url: string, ctx: ScrapeContext) {
    try {
      const staticHtml = ctx.prefetchedHtml ?? (await fetchHtml(url))
      const urlPlatform = identifyPlatform(url)
      const platform = identifyPlatform(url, staticHtml ?? '')
      const adapter = adapters.find(
        (candidate) =>
          candidate.matches(url) ||
          (urlPlatform === null &&
            platform !== null &&
            candidate.platform === platform),
      )
      if (!adapter) return emptyResult(url)

      let parsedHtml = staticHtml ?? ''
      let result = adapter.parse(parsedHtml, url)

      // If static parse found no gallery images, try rendering
      if (result.galleryImageUrls.length === 0 && ctx.render) {
        const { html } = await ctx.render.fetchRendered(url)
        parsedHtml = html
        result = adapter.parse(html, url)
      }

      // 91App detail-page hydration: supplement listing images with
      // larger images from individual product detail pages.
      if (
        adapter.platform === '91app' &&
        result.galleryImageUrls.length > 0
      ) {
        const routes = extractCatalogRoutes(parsedHtml, url).slice(
          0,
          HYDRATION_LIMIT,
        )
        const detailEntries: Array<{ url: string; pageUrl: string }> = []

        for (const route of routes) {
          try {
            const detailHtml = await fetchHtml(route.url)
            if (!detailHtml) continue
            const $ = cheerio.load(detailHtml)
            const ogImageRaw = metaContent($, 'meta[property="og:image"]')
            if (ogImageRaw) {
              try {
                const resolved = new URL(ogImageRaw, route.url).href
                detailEntries.push({
                  url: upgradeEcommerceImageUrl(resolved),
                  pageUrl: route.url,
                })
              } catch {
                // skip malformed og:image URL
              }
            }
            const jsonLdImages = extractJsonLdImages(
              extractAllJsonLd($),
              route.url,
            )
            for (const img of jsonLdImages) {
              detailEntries.push({ url: img, pageUrl: route.url })
            }
          } catch {
            // Skip failed detail-page fetches silently
          }
        }

        if (detailEntries.length > 0) {
          const seen = new Set(result.galleryImageUrls)
          const newImages: string[] = []
          const newSources: ScrapedImageSource[] = []
          const method =
            result.imageSources?.[0]?.method ?? '91app_adapter'

          for (const entry of detailEntries) {
            if (seen.has(entry.url)) continue
            seen.add(entry.url)
            if (
              result.galleryImageUrls.length + newImages.length >=
              MARKETPLACE_GALLERY_LIMIT
            )
              break
            newImages.push(entry.url)
            newSources.push({
              url: entry.url,
              method,
              pageUrl: entry.pageUrl,
              position:
                result.galleryImageUrls.length + newImages.length - 1,
            })
          }

          result = {
            ...result,
            galleryImageUrls: [...result.galleryImageUrls, ...newImages],
            imageSources: [
              ...(result.imageSources ?? []),
              ...newSources,
            ],
          }
        }
      }

      return result
    } catch {
      return emptyResult(url)
    }
  }
}
