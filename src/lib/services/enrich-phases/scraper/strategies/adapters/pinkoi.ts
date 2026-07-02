import { extractPinkoiProductImages } from '../../parse/extractors'
import { createMarketplaceAdapter } from './create-marketplace-adapter'

export const pinkoiAdapter = createMarketplaceAdapter({
  host: 'pinkoi.com',
  titleSuffixPatterns: [/\s*[|-]\s*Pinkoi.*$/i, /\s*Pinkoi.*$/i],
  productImageExtractor: extractPinkoiProductImages,
  purchaseKey: 'purchasePinkoi',
  shopNameSelector: '[class*="store-name"]',
  shopDescriptionSelector: '[class*="story"]',
})
