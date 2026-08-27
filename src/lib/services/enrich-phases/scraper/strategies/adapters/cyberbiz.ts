import { extractScopedProductImages } from '../../parse/extractors'
import { createMarketplaceAdapter } from './create-marketplace-adapter'

export const cyberbizAdapter = createMarketplaceAdapter({
  host: 'cyberbiz.co',
  platform: 'cyberbiz',
  titleSuffixPatterns: [/\s*[|–-]\s*CYBERBIZ.*$/i],
  productImageExtractor: ($, pageUrl, limit) =>
    extractScopedProductImages(
      $,
      [
        '[data-product-id] img',
        '.product-card img',
        '.product-item img',
        'a[href*="/products/"] img',
      ],
      pageUrl,
      limit,
    ),
  purchaseKey: 'purchaseWebsite',
  imageMethod: 'cyberbiz_adapter',
})
