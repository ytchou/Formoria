import { extractShopeeProductImages } from '../../parse/extractors'
import { createMarketplaceAdapter } from './create-marketplace-adapter'

export const shopeeAdapter = createMarketplaceAdapter({
  host: 'shopee.tw',
  titleSuffixPatterns: [/\s*[|-]\s*Shopee.*$/i, /\s*Shopee$/i],
  productImageExtractor: extractShopeeProductImages,
  purchaseKey: 'purchaseShopee',
  imageMethod: 'shopee_adapter',
  fallbackNameSelector: '[data-testid*="shop"] h1',
  fallbackDescriptionSelectors: ['[class*="shop-description"]', '[class*="description"]'],
})
