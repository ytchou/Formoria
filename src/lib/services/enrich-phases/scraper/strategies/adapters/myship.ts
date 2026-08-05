import { extractMyshipProductImages } from '../../parse/extractors'
import { createMarketplaceAdapter } from './create-marketplace-adapter'

export const myshipAdapter = createMarketplaceAdapter({
  host: 'myship.7-11.com.tw',
  titleSuffixPatterns: [/\s*[|-]\s*7-ELEVEN.*$/i],
  productImageExtractor: extractMyshipProductImages,
  purchaseKey: 'purchaseMyship',
  imageMethod: 'myship_adapter',
  fallbackNameSelector: '[data-testid*="shop"] h1',
  fallbackDescriptionSelectors: ['[class*="description"]'],
})
