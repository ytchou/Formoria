import type { CatalogSource } from './catalog-discovery'
import type { EnrichBrand } from './types'

/**
 * The brand's own purchase channels, as catalog-discovery sources.
 *
 * Exported because catalog discovery moves into the acquire phase: the sources
 * are a property of the brand, not of the retired images phase, and deriving
 * them a second time there is how the two would drift on the next channel
 * column.
 */
export function buildChannelSources(brand: EnrichBrand): CatalogSource[] {
  const urls = [
    ...new Set(
      [
        brand.purchase_website ?? brand.purchaseWebsite,
        brand.purchase_pinkoi,
        brand.purchase_shopee,
        brand.purchase_myship,
      ].filter(
        (value): value is string =>
          typeof value === 'string' && value.length > 0,
      ),
    ),
  ]
  const siteUrl = brand.purchase_website ?? brand.purchaseWebsite
  return urls.map((url, index) => ({
    url,
    channel:
      index === 0 && url === siteUrl
        ? ('official' as const)
        : url === brand.purchase_pinkoi
          ? ('pinkoi' as const)
          : url === brand.purchase_shopee
            ? ('shopee' as const)
            : ('myship' as const),
  }))
}
