import { extractPinkoiProductImages } from '../../parse/extractors'
import { createMarketplaceAdapter } from './create-marketplace-adapter'

export const pinkoiAdapter = createMarketplaceAdapter({
  host: 'pinkoi.com',
  platform: 'pinkoi',
  titleSuffixPatterns: [/\s*[|-]\s*Pinkoi.*$/i, /\s*Pinkoi.*$/i],
  productImageExtractor: ($, _pageUrl, limit) =>
    extractPinkoiProductImages($, limit),
  purchaseKey: 'purchasePinkoi',
  imageMethod: 'pinkoi_adapter',
  shopNameSelector: '[class*="store-name"]',
  fallbackNameSelector: '[data-testid*="store"] h1',
  fallbackDescriptionSelectors: ['[class*="description"]', '[class*="story"]'],
})
