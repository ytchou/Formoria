import { extractPinkoiProductImages } from '../../parse/extractors'
import { createMarketplaceAdapter } from './create-marketplace-adapter'

export const pinkoiAdapter = createMarketplaceAdapter({
  host: 'pinkoi.com',
  titleSuffixPatterns: [/\s*[|-]\s*Pinkoi.*$/i, /\s*Pinkoi.*$/i],
  productImageExtractor: extractPinkoiProductImages,
  purchaseKey: 'purchasePinkoi',
  imageMethod: 'pinkoi_adapter',
  fallbackNameSelector: '[data-testid*="store"] h1',
  fallbackDescriptionSelectors: ['[class*="description"]', '[class*="story"]'],
})
