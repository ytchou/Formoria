import type { InputType, ScrapeStrategy } from './strategies/types'
import { CrawlStrategy } from './strategies/crawl'
import { PlatformAdapterStrategy } from './strategies/platform-adapter'
import { SinglePageStrategy } from './strategies/single-page'

const platformAdapterStrategy = new PlatformAdapterStrategy()
const crawlStrategy = new CrawlStrategy()
const singlePageStrategy = new SinglePageStrategy()

export function selectStrategy(
  type: InputType,
  url: string
): ScrapeStrategy {
  void url

  if (type === 'social' || type === 'e-commerce') {
    return platformAdapterStrategy
  }

  if (type === 'deep-multi-page') {
    return crawlStrategy
  }

  return singlePageStrategy
}
