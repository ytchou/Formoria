import type { MetadataRoute } from 'next'
import { localizedEntries, latestBrandDate } from '@/app/sitemap'
import { matchSubcategory } from '@/lib/taxonomy/ontology'
import { listIndexableTargets } from './directory-indexation'
import type { BrandSeoEntry } from '@/lib/services/brands'

const DIRECTORY_LOCALES = ['zh-TW', 'en'] as const

function hasTargetSubcategory(brand: BrandSeoEntry, subcategorySlug: string): boolean {
  return brand.subcategories.some(
    (tag) => matchSubcategory(tag)?.slug === subcategorySlug,
  )
}

export function buildDirectorySitemapEntries(
  brands: ReadonlyArray<BrandSeoEntry>,
): MetadataRoute.Sitemap {
  return listIndexableTargets().flatMap((target) => {
    const members = brands.filter(
      (brand) =>
        brand.categorySlug === target.categorySlug &&
        (!target.subcategorySlug || hasTargetSubcategory(brand, target.subcategorySlug)),
    )
    const path = target.subcategorySlug
      ? `/categories/${target.categorySlug}/${target.subcategorySlug}`
      : `/categories/${target.categorySlug}`

    return localizedEntries(
      path,
      DIRECTORY_LOCALES,
      latestBrandDate(members),
    )
  })
}

export async function buildDirectorySitemapSection(
  brandsPromise: Promise<ReadonlyArray<BrandSeoEntry>>,
): Promise<MetadataRoute.Sitemap> {
  return brandsPromise.then(buildDirectorySitemapEntries).catch(() => [])
}
