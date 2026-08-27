import { extractScopedProductImages } from '../../parse/extractors'
import { createMarketplaceAdapter } from './create-marketplace-adapter'

export const shoplineAdapter = createMarketplaceAdapter({
  host: 'shoplineapp.com',
  platform: 'shopline',
  titleSuffixPatterns: [/\s*[|–-]\s*SHOPLINE.*$/i],
  productImageExtractor: ($, pageUrl, limit) =>
    extractScopedProductImages(
      $,
      [
        '[data-product-id] img',
        '.product-item img',
        '.product-card img',
        'a[href*="/products/"] img',
      ],
      pageUrl,
      limit,
    ),
  purchaseKey: 'purchaseWebsite',
  imageMethod: 'shopline_adapter',
})
