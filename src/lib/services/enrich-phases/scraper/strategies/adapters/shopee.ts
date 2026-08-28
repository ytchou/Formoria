import { extractShopeeProductImages } from '../../parse/extractors'
import { createMarketplaceAdapter } from './create-marketplace-adapter'

export const shopeeAdapter = createMarketplaceAdapter({
  host: 'shopee.tw',
  platform: 'shopee',
  titleSuffixPatterns: [/\s*[|-]\s*Shopee.*$/i, /\s*Shopee$/i],
  productImageExtractor: ($, _pageUrl, limit) =>
    extractShopeeProductImages($, limit),
  purchaseKey: 'purchaseShopee',
  imageMethod: 'shopee_adapter',
  shopNameSelector: '[class*="shop-name"]',
  fallbackNameSelector: '[data-testid*="shop"] h1',
  fallbackDescriptionSelectors: [
    '[class*="shop-description"]',
    '[class*="description"]',
  ],
})
