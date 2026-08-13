import type { MetadataRoute } from 'next'
import { localizedEntries } from '@/app/sitemap'
import { citySlugToPath } from '@/lib/constants/taiwan-cities'
import {
  summarizeStockistCities,
  type StockistLocation,
} from '@/lib/services/brand-channels'

export function buildWhereToBuySitemapEntries(
  locations: StockistLocation[],
): MetadataRoute.Sitemap {
  return [
    ...localizedEntries('/where-to-buy'),
    ...summarizeStockistCities(locations).flatMap(({ city }) =>
      localizedEntries(`/where-to-buy/${citySlugToPath(city)}`),
    ),
  ]
}

export async function buildWhereToBuySitemapSection(
  locationsPromise: Promise<StockistLocation[]>,
): Promise<MetadataRoute.Sitemap> {
  return locationsPromise.then(buildWhereToBuySitemapEntries).catch(() => [])
}
