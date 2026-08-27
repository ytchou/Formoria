import { extractScopedProductImages } from '../../parse/extractors'
import { createMarketplaceAdapter } from './create-marketplace-adapter'

export const ninetyOneAppAdapter = createMarketplaceAdapter({
  host: '91app.com',
  platform: '91app',
  titleSuffixPatterns: [/\s*[|–-]\s*91APP.*$/i],
  productImageExtractor: ($, pageUrl, limit) =>
    extractScopedProductImages(
      $,
      [
        '[data-salepageid] img',
        '.product-card img',
        'a[href*="SalePage/Index"] img',
      ],
      pageUrl,
      limit,
    ),
  purchaseKey: 'purchaseWebsite',
  imageMethod: '91app_adapter',
})
