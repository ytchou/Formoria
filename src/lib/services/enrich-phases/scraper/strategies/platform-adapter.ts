import { emptyResult } from '../parse/extractors'
import { instagramAdapter } from './adapters/instagram'
import { pinkoiAdapter } from './adapters/pinkoi'
import { shopeeAdapter } from './adapters/shopee'
import type { PlatformAdapter } from './adapters/types'
import type { ScrapeContext, ScrapeStrategy } from './types'

const adapters: PlatformAdapter[] = [
  pinkoiAdapter,
  shopeeAdapter,
  instagramAdapter,
]

export class PlatformAdapterStrategy implements ScrapeStrategy {
  readonly type = 'e-commerce'

  async scrape(url: string, ctx: ScrapeContext) {
    const adapter = adapters.find((candidate) => candidate.matches(url))
    if (!adapter) return emptyResult(url)

    try {
      const { html } = await ctx.render.fetchRendered(url)
      return adapter.parse(html, url)
    } catch {
      return emptyResult(url)
    }
  }
}

