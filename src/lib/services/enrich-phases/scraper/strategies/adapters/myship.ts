import { onlineStoreByKey } from '@/lib/brands/online-stores'
import { extractMyshipProductImages } from '../../parse/extractors'
import { createMarketplaceAdapter } from './create-marketplace-adapter'

const MYSHIP_STOREFRONT_PATTERN = onlineStoreByKey.myship.urlPattern

export const myshipAdapter = createMarketplaceAdapter({
  host: 'myship.7-11.com.tw',
  platform: 'myship',
  // Host alone is not enough here: the MyShip host also serves the landing
  // page, help and shipping pages, whose title and og:description would
  // otherwise be parsed as a brand's name and story. Pinkoi and Shopee keep
  // their host-only match deliberately — narrowing those is a separate call.
  matchesPath: (url) => MYSHIP_STOREFRONT_PATTERN?.test(url) ?? true,
  titleSuffixPatterns: [/\s*[|-]\s*7-ELEVEN.*$/i],
  productImageExtractor: ($, _pageUrl, limit) =>
    extractMyshipProductImages($, limit),
  purchaseKey: 'purchaseMyship',
  imageMethod: 'myship_adapter',
  fallbackNameSelector: '[data-testid*="shop"] h1',
  fallbackDescriptionSelectors: ['[class*="description"]'],
})
