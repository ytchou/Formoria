import type { MetadataRoute } from 'next'
import { localizedEntries } from '@/app/sitemap'
import { citySlugToPath } from '@/lib/constants/taiwan-cities'
import {
  summarizeStockistCities,
  type StockistLocation,
} from '@/lib/services/stockists'
import { routes } from '@/lib/routes'

export function buildWhereToBuySitemapEntries(
  locations: StockistLocation[],
): MetadataRoute.Sitemap {
  return [
    ...localizedEntries(routes.whereToBuy()),
    ...summarizeStockistCities(locations).flatMap(({ city }) =>
      localizedEntries(routes.whereToBuyCity(citySlugToPath(city))),
    ),
  ]
}

export async function buildWhereToBuySitemapSection(
  locationsPromise: Promise<StockistLocation[]>,
): Promise<MetadataRoute.Sitemap> {
  return locationsPromise.then(buildWhereToBuySitemapEntries).catch(() => [])
}
