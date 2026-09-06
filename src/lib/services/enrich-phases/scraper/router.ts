import type { InputType, ScrapeStrategy } from './strategies/types'
import { CrawlStrategy } from './strategies/crawl'
import { PlatformAdapterStrategy } from './strategies/platform-adapter'
import { SinglePageStrategy } from './strategies/single-page'

const platformAdapterStrategy = new PlatformAdapterStrategy()
const crawlStrategy = new CrawlStrategy()
const singlePageStrategy = new SinglePageStrategy()

export function selectStrategy(
  type: InputType,
  url: string,
  directive?: { strategy?: InputType },
): ScrapeStrategy {
  void url

  const effective = directive?.strategy ?? type

  if (effective === 'social' || effective === 'e-commerce') {
    return platformAdapterStrategy
  }

  if (effective === 'deep-multi-page') {
    return crawlStrategy
  }

  return singlePageStrategy
}
