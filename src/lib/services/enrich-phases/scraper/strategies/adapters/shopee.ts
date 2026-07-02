import { extractShopeeProductImages } from '../../parse/extractors'
import { createMarketplaceAdapter } from './create-marketplace-adapter'

export const shopeeAdapter = createMarketplaceAdapter({
  host: 'shopee.tw',
  titleSuffixPatterns: [/\s*[|-]\s*Shopee.*$/i, /\s*Shopee$/i],
  productImageExtractor: extractShopeeProductImages,
  purchaseKey: 'purchaseShopee',
  shopNameSelector: '[class*="shop-name"]',
  shopDescriptionSelector: '[class*="shop-description"]',
})
