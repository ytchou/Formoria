import type { ScrapedBrandData } from '@/lib/types/scraper'
import { getRenderProvider } from './render/index'
import { SinglePageStrategy } from './strategies/single-page'

export async function scrapeBrandUrl(url: string): Promise<ScrapedBrandData> {
  return new SinglePageStrategy().scrape(url, { render: getRenderProvider() })
}

export { SinglePageStrategy }
export type { ScrapedBrandData } from '@/lib/types/scraper'
export type {
  InputType,
  ScrapeContext,
  ScrapeStrategy,
} from './strategies/types'
export type { RenderProvider, RenderResult } from './render/types'
