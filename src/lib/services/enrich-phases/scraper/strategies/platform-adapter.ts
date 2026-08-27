import { emptyResult } from '../parse/extractors'
import { instagramAdapter } from './adapters/instagram'
import { myshipAdapter } from './adapters/myship'
import { pinkoiAdapter } from './adapters/pinkoi'
import { shopeeAdapter } from './adapters/shopee'
import { fetchHtml } from '../fetch-guards'
import { shoplineAdapter } from './adapters/shopline'
import { ninetyOneAppAdapter } from './adapters/ninety-one-app'
import { cyberbizAdapter } from './adapters/cyberbiz'
import { identifyPlatform } from '../platforms'
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
      const staticResult = adapter.parse(staticHtml ?? '', url)
      if (staticResult.galleryImageUrls.length > 0 || !ctx.render)
        return staticResult

      const { html } = await ctx.render.fetchRendered(url)
      return adapter.parse(html, url)
    } catch {
      return emptyResult(url)
    }
  }
}
