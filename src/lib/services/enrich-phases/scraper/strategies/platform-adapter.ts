import * as cheerio from 'cheerio'
import {
  emptyResult,
  extractAllJsonLd,
  extractJsonLdImages,
  metaContent,
  toImageSources,
} from '../parse/extractors'
import { instagramAdapter } from './adapters/instagram'
import { myshipAdapter } from './adapters/myship'
import { pinkoiAdapter } from './adapters/pinkoi'
import { shopeeAdapter } from './adapters/shopee'
import { fetchHtml } from '../fetch-guards'
import { shoplineAdapter } from './adapters/shopline'
import { ninetyOneAppAdapter } from './adapters/ninety-one-app'
import { cyberbizAdapter } from './adapters/cyberbiz'
import { identifyPlatform } from '../platforms'
import { extractCatalogRoutes } from '../../catalog-discovery'
import type { PlatformAdapter } from './adapters/types'
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
const MARKETPLACE_GALLERY_LIMIT = 20

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
        const detailImages: string[] = []

        for (const route of routes) {
          try {
            const detailHtml = await fetchHtml(route.url)
            if (!detailHtml) continue
            const $ = cheerio.load(detailHtml)
            const ogImage = metaContent($, 'meta[property="og:image"]')
            if (ogImage) detailImages.push(ogImage)
            const jsonLdImages = extractJsonLdImages(
              extractAllJsonLd($),
              route.url,
            )
            detailImages.push(...jsonLdImages)
          } catch {
            // Skip failed detail-page fetches silently
          }
        }

        if (detailImages.length > 0) {
          const combined = [
            ...new Set([...result.galleryImageUrls, ...detailImages]),
          ].slice(0, MARKETPLACE_GALLERY_LIMIT)
          result = {
            ...result,
            galleryImageUrls: combined,
            imageSources: toImageSources(
              combined,
              result.imageSources?.[0]?.method ?? '91app_adapter',
              url,
            ),
          }
        }
      }

      return result
    } catch {
      return emptyResult(url)
    }
  }
}
