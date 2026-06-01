import type { ScrapedBrandData } from '@/lib/types/scraper'
import type { RenderProvider } from '../render/types'

export type InputType = 'official-site' | 'social' | 'e-commerce' | 'deep-multi-page'

export interface ScrapeContext {
  render: RenderProvider
  prefetchedHtml?: string | null
  maxCrawlPages?: number
}
export interface ScrapeStrategy {
  readonly type: InputType
  scrape(url: string, ctx: ScrapeContext): Promise<ScrapedBrandData>
}
