import type { ScrapedBrandData } from '@/lib/types/scraper'
import { fetchHtml } from './fetch-guards'
import { classifyByDomain, detectInputType } from './input-detector'
import { mergeScrapedData } from './merge'
import { getRenderProvider } from './render/index'
import { selectStrategy } from './router'
import { SinglePageStrategy } from './strategies/single-page'
import type { InputType } from './strategies/types'

export type MultiScrapeResult = {
  data: ScrapedBrandData
  statuses: Array<{
    url: string
    ok: boolean
    classification: InputType
  }>
}

function hasContent(data: ScrapedBrandData): boolean {
  return Boolean(
    data.brandName ||
      data.description ||
      data.story ||
      data.heroImageUrl ||
      data.galleryImageUrls.length > 0 ||
      data.socialInstagram ||
      data.socialThreads ||
      data.socialFacebook ||
      data.purchaseWebsite ||
      data.purchasePinkoi ||
      data.purchaseShopee ||
      data.categoryHints.length > 0 ||
      data.rawJsonLd
  )
}

export async function scrapeBrandUrl(url: string): Promise<ScrapedBrandData> {
  return (await scrapeBrandUrls([url])).data
}

export async function scrapeBrandUrls(urls: string[]): Promise<MultiScrapeResult> {
  const render = getRenderProvider()
  const results = await Promise.all(
    urls.slice(0, 3).map(async (url) => {
      // Pre-fetch HTML once for URLs that aren't known social/ecommerce domains.
      // This avoids consuming the same Response body twice (detectInputType +
      // strategy.scrape both call fetchHtml otherwise).
      const prefetchedHtml = classifyByDomain(url) === null
        ? await fetchHtml(url)
        : null

      const type = await detectInputType(url, prefetchedHtml)
      const strategy = selectStrategy(type, url)
      const data = await strategy.scrape(url, { render, prefetchedHtml })

      return {
        type,
        data,
        status: {
          url,
          ok: hasContent(data),
          classification: type,
        },
      }
    })
  )

  return {
    data: mergeScrapedData(results.map(({ type, data }) => ({ type, data }))),
    statuses: results.map(({ status }) => status),
  }
}

export { mergeScrapedData }
export { SinglePageStrategy }
export type { ScrapedBrandData } from '@/lib/types/scraper'
export type {
  InputType,
  ScrapeContext,
  ScrapeStrategy,
} from './strategies/types'
export type { RenderProvider, RenderResult } from './render/types'
