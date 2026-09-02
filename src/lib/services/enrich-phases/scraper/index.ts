import { randomUUID } from 'node:crypto'
import { auditedCall, type AuditStatus } from '@/lib/audit'
import type { ScrapedBrandData } from '@/lib/types/scraper'
import { fetchHtmlWithMetadata } from './fetch-guards'
import { classifyByDomain, detectInputType, isThirdPartyDirectoryHost } from './input-detector'
import { ONLINE_STORES } from '@/lib/brands/online-stores'
import { mergeScrapedData } from './merge'
import { emptyResult } from './parse/extractors'
import type { RenderProvider } from './render/types'
import { selectStrategy } from './router'
import type { InputType, SurfaceDirective } from './strategies/types'
import { identifyPlatform } from './platforms'

export type ScrapeAttemptFinish = {
  callStatus: 'succeeded' | 'empty' | 'failed' | 'malformed' | 'timeout' | 'network_error' | 'skipped'
  httpStatus?: number | null
  error?: string | null
  latencyMs?: number | null
  extracted?: unknown
}

export type ScrapeAttemptHandle = {
  finish: (result: ScrapeAttemptFinish) => Promise<void>
}

export type ScrapeBrandUrlsOptions = {
  brandName?: string | null
  confirmedSourceUrls?: ReadonlySet<string>
  renderProvider?: RenderProvider
  directives?: ReadonlyMap<string, SurfaceDirective>
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
 * so a brand's marketplace pages were never reached and the marketplace
 * adapters (20 images each) never fired at all.
 */
export const MAX_SCRAPE_URLS_PER_BRAND = 6

/**
 * Drops the link fields harvested from a page the brand does not own.
 *
 * The text and images on a third-party page can still describe the brand — an
 * exhibitor listing carries its blurb and product shots — but the accounts
 * linked from it belong to whoever runs the page. Those are the fields that
 * published a stranger's Facebook page as 23 brands' own (DEV-1332), so they are
 * the only ones dropped. Applied before `hasContent` and before the audit
 * snapshot, so the trail records what we actually kept.
 */
function withoutThirdPartyLinks(url: string, data: ScrapedBrandData): ScrapedBrandData {
  if (!isThirdPartyDirectoryHost(url)) return data

  return {
    ...data,
    socialInstagram: null,
    socialThreads: null,
    socialFacebook: null,
    ...Object.fromEntries(ONLINE_STORES.map((channel) => [channel.camel, null])),
  }
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
    data.purchaseMyship ||
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
    purchaseMyship: data.purchaseMyship,
  }
}

export async function scrapeBrandUrls(
  urls: string[],
  options: ScrapeBrandUrlsOptions = {},
): Promise<MultiScrapeResult> {
  const render = options.renderProvider
  const directives = options.directives
  const results = await Promise.all(
    urls.slice(0, MAX_SCRAPE_URLS_PER_BRAND).map(async (url) => {
      const directive = directives?.get(url)
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

      // Directive: skip — record and move on without any network call.
      if (directive?.fetch === 'skip') {
        await finishAudit({
          callStatus: 'skipped',
          httpStatus: null,
          error: null,
          latencyMs: 0,
          extracted: boundedExtractedData(emptyResult(url)),
        })
        return {
          type: initialType,
          data: emptyResult(url),
          status: {
            url,
            ok: false,
            classification: initialType,
            httpStatus: null,
            latencyMs: 0,
            error: null,
          },
          callStatus: 'skipped' as const,
        }
      }

      const result = await auditedCall(
        {
          provider: 'scraper',
          operation: 'scrape_url',
          kind: 'external',
          spanId,
        },
        async (ctx) => {
          let httpStatus: number | null = null
          let error: string | null = null
          const startedAt = Date.now()

          try {
            let prefetchedHtml: string | null = null

            // Directive: render — use the render provider to fetch the page,
            // bypassing the static prefetch entirely.
            if (directive?.fetch === 'render' && render) {
              try {
                const renderResult = await render.fetchRendered(url)
                prefetchedHtml = renderResult.html
                httpStatus = renderResult.status
              } catch (renderErr) {
                const message = renderErr instanceof Error ? renderErr.message.slice(0, 1_000) : String(renderErr).slice(0, 1_000)
                await finishAudit({
                  callStatus: 'failed',
                  httpStatus: null,
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
                    httpStatus: null,
                    latencyMs: Date.now() - startedAt,
                    error: message,
                  },
                  callStatus: 'failed' as const,
                }
              }
            } else {
              // Default static prefetch for URLs that aren't known social/ecommerce domains.
              // This avoids consuming the same Response body twice (detectInputType +
              // strategy.scrape both call fetchHtml otherwise).
              const prefetched = classifyByDomain(url) === null ? await fetchHtmlWithMetadata(url) : null
              prefetchedHtml = prefetched?.text ?? null
              httpStatus = prefetched?.status ?? null
              error = prefetched?.error ?? null
            }

            const type = await detectInputType(url, prefetchedHtml)
            const strategy = selectStrategy(type, url, directive)
            let rendered = directive?.fetch === 'render'
            const trackedRender: RenderProvider | undefined = render ? {
              fetchRendered: async (renderUrl) => {
                rendered = true
                const result = await render.fetchRendered(renderUrl)
                httpStatus = result.status
                return result
              },
              ...(render.fetchRenderedBatch
                ? {
                    fetchRenderedBatch: async (renderUrls: readonly string[]) => {
                      rendered = true
                      return render.fetchRenderedBatch!(renderUrls)
                    },
                  }
                : {}),
            } : undefined
            const data = withoutThirdPartyLinks(
              url,
              await strategy.scrape(url, {
                render: trackedRender,
                prefetchedHtml,
              }),
            )
            const ok = hasContent(data)
            const uniqueSources = [
              ...new Map(
                (data.imageSources ?? []).map((source) => [
                  `${source.method}\u0000${source.url}`,
                  source,
                ]),
              ).values(),
            ]
            const methodCounts = Object.fromEntries(
              [...new Set(uniqueSources.map((source) => source.method))].map(
                (method) => [
                  method,
                  uniqueSources.filter((source) => source.method === method)
                    .length,
                ],
              ),
            )
            const callStatus: AuditStatus = ok ? 'succeeded' : error ? 'failed' : 'empty'
            Object.assign(ctx.summary, {
              detectedPlatform: identifyPlatform(url, prefetchedHtml ?? ''),
              extractor: (data.imageSources ?? []).at(0)?.method ?? strategy.type,
              renderMode: rendered ? 'static_then_rendered' : 'static_only',
              uniqueImages: new Set(data.galleryImageUrls).size,
              methodCounts,
            })
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
    data: mergeScrapedData(results.map(({ type, data, status }) => ({ type, data, sourceUrl: status.url }))),
    statuses: results.map(({ status }) => status),
  }
}
