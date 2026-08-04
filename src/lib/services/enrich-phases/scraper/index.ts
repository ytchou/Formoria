import { randomUUID } from 'node:crypto'
import { auditedCall, type AuditStatus } from '@/lib/audit'
import type { ScrapedBrandData } from '@/lib/types/scraper'
import { fetchHtmlWithMetadata } from './fetch-guards'
import { classifyByDomain, detectInputType } from './input-detector'
import { mergeScrapedData } from './merge'
import { emptyResult } from './parse/extractors'
import { getRenderProvider } from './render/index'
import type { RenderProvider } from './render/types'
import { selectStrategy } from './router'
import type { InputType } from './strategies/types'

export type ScrapeAttemptFinish = {
  callStatus: 'succeeded' | 'empty' | 'failed' | 'malformed' | 'timeout' | 'network_error'
  httpStatus?: number | null
  error?: string | null
  latencyMs?: number | null
  extracted?: unknown
}

export type ScrapeAttemptHandle = {
  finish: (result: ScrapeAttemptFinish) => Promise<void>
}

export type ScrapeBrandUrlsOptions = {
  onAttempt?: (input: { url: string; classification: InputType; spanId: string }) => Promise<ScrapeAttemptHandle | undefined>
}

export type MultiScrapeResult = {
  data: ScrapedBrandData
  statuses: Array<{
    url: string
    ok: boolean
    classification: InputType
    httpStatus: number | null
    latencyMs: number
    error: string | null
  }>
}

/**
 * Scraping is free in API-credit terms — each URL is one render fetch, not a
 * paid search call — so the cap exists only to bound wall-clock per brand. The
 * previous 3 was routinely spent on the official site plus two social profiles,
 * so a brand's Pinkoi/Shopee pages were never reached and the marketplace
 * adapters (20 images each) never fired at all.
 */
export const MAX_SCRAPE_URLS_PER_BRAND = 6

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
    data.jsonLdImageUrls.length > 0 ||
    data.rawJsonLd,
  )
}

function boundedExtractedData(data: ScrapedBrandData): Record<string, unknown> {
  return {
    brandName: data.brandName,
    description: data.description?.slice(0, 4_000) ?? null,
    story: data.story?.slice(0, 4_000) ?? null,
    stockistPageText: data.stockistPageText?.slice(0, 4_000) ?? null,
    websiteUrl: data.websiteUrl,
    socialInstagram: data.socialInstagram,
    socialThreads: data.socialThreads,
    socialFacebook: data.socialFacebook,
    purchaseWebsite: data.purchaseWebsite,
    purchasePinkoi: data.purchasePinkoi,
    purchaseShopee: data.purchaseShopee,
  }
}

export async function scrapeBrandUrls(
  urls: string[],
  options: ScrapeBrandUrlsOptions = {},
): Promise<MultiScrapeResult> {
  const render = getRenderProvider()
  const results = await Promise.all(
    urls.slice(0, MAX_SCRAPE_URLS_PER_BRAND).map(async (url) => {
      const initialType = classifyByDomain(url) ?? 'official-site'
      const spanId = randomUUID()
      const audit = await options.onAttempt?.({
        url,
        classification: initialType,
        spanId,
      })
      let auditFinished = false
      const finishAudit = async (result: ScrapeAttemptFinish): Promise<void> => {
        if (auditFinished) return
        auditFinished = true
        await audit?.finish(result)
      }
      const result = await auditedCall(
        {
          provider: 'scraper',
          operation: 'scrape_url',
          kind: 'external',
          spanId,
        },
        async () => {
          let httpStatus: number | null = null
          let error: string | null = null
          const startedAt = Date.now()

          try {
            // Pre-fetch HTML once for URLs that aren't known social/ecommerce domains.
            // This avoids consuming the same Response body twice (detectInputType +
            // strategy.scrape both call fetchHtml otherwise).
            const prefetched = classifyByDomain(url) === null ? await fetchHtmlWithMetadata(url) : null
            const prefetchedHtml = prefetched?.text ?? null
            httpStatus = prefetched?.status ?? null
            error = prefetched?.error ?? null

            const type = await detectInputType(url, prefetchedHtml)
            const strategy = selectStrategy(type, url)
            const trackedRender: RenderProvider = {
              fetchRendered: async (renderUrl) => {
                const result = await render.fetchRendered(renderUrl)
                httpStatus = result.status
                return result
              },
            }
            const data = await strategy.scrape(url, {
              render: trackedRender,
              prefetchedHtml,
            })
            const ok = hasContent(data)
            const callStatus: AuditStatus = ok ? 'succeeded' : error ? 'failed' : 'empty'
            await finishAudit({
              callStatus,
              httpStatus,
              error: ok ? null : error,
              latencyMs: Date.now() - startedAt,
              extracted: boundedExtractedData(data),
            })

            return {
              type,
              data,
              status: {
                url,
                ok,
                classification: type,
                httpStatus,
                latencyMs: Date.now() - startedAt,
                error: ok ? null : error,
              },
              callStatus,
            }
          } catch (caught) {
            if (auditFinished) throw caught
            const message = caught instanceof Error ? caught.message.slice(0, 1_000) : String(caught).slice(0, 1_000)
            const timedOut =
              caught instanceof Error && (caught.name === 'AbortError' || /timeout|timed out/i.test(caught.message))
            const callStatus: AuditStatus = timedOut ? 'timeout' : 'network_error'
            await finishAudit({
              callStatus,
              httpStatus,
              error: message,
              latencyMs: Date.now() - startedAt,
              extracted: boundedExtractedData(emptyResult(url)),
            })
            return {
              type: initialType,
              data: emptyResult(url),
              status: {
                url,
                ok: false,
                classification: initialType,
                httpStatus,
                latencyMs: Date.now() - startedAt,
                error: message,
              },
              callStatus,
            }
          }
        },
        {
          classify: (scrapeResult) => scrapeResult.callStatus,
          summary: { url, classification: initialType },
        },
      )

      return {
        type: result.type,
        data: result.data,
        status: result.status,
      }
    }),
  )

  return {
    data: mergeScrapedData(results.map(({ type, data }) => ({ type, data }))),
    statuses: results.map(({ status }) => status),
  }
}
