import type { ScrapedBrandData } from '@/lib/types/scraper'
import type { PlatformId } from '../platforms'
import type { RenderProvider } from '../render/types'

export type InputType =
  'official-site' | 'social' | 'e-commerce' | 'deep-multi-page'

export type SurfaceDirective = {
  fetch: 'static' | 'render' | 'skip'
  strategy?: InputType
  adapter?: PlatformId
  reason: string
}

export interface ScrapeContext {
  render?: RenderProvider
  prefetchedHtml?: string | null
  maxCrawlPages?: number
}
export interface ScrapeStrategy {
  readonly type: InputType
  scrape(url: string, ctx: ScrapeContext): Promise<ScrapedBrandData>
}
