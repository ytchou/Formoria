import type { MetadataRoute } from 'next'
import { localizedEntries, latestBrandDate } from '@/app/sitemap'
import { subcategoryBySlug } from '@/lib/taxonomy/ontology'
import { listIndexableTargets, type DirectoryTarget } from './directory-indexation'
import type { BrandSeoEntry } from '@/lib/services/brands'
import { routes } from '@/lib/routes'

const DIRECTORY_LOCALES = ['zh-TW', 'en'] as const

type DirectoryMember = Pick<BrandSeoEntry, 'categorySlug' | 'subcategories'>

/**
 * Whether a brand is listed by a directory target — the same rule the page
 * itself selects on, which is why it lives in one place.
 *
 * An **L2** target asks only for the tag. Conjoining the brand's own L1 dropped
 * 429 of 2,446 approved tag-uses, so a `fashion` brand tagged `backpacks` was
 * missing from `/categories/bags-accessories/backpacks` *and* from that page's
 * sitemap lastmod (DEV-1510). An **L1** target keeps the category test: that is
 * what the L1 page lists.
 *
 * Tags are matched as slugs, not labels: storage became English slugs in task 9,
 * and a label-based lookup silently misses every slug whose `nameEn` does not
 * normalize back onto it (`belt-and-sling-bags` vs `Belt & Sling Bags`).
 */
export function isDirectoryTargetMember(
  brand: DirectoryMember,
  target: Pick<DirectoryTarget, 'categorySlug' | 'subcategorySlug'>,
): boolean {
  if (target.subcategorySlug) {
    return brand.subcategories.some(
      (tag) => subcategoryBySlug(tag)?.slug === target.subcategorySlug,
    )
  }
  return brand.categorySlug === target.categorySlug
}

export function buildDirectorySitemapEntries(
  brands: ReadonlyArray<BrandSeoEntry>,
): MetadataRoute.Sitemap {
  return listIndexableTargets().flatMap((target) => {
    const members = brands.filter((brand) => isDirectoryTargetMember(brand, target))
    const path = target.subcategorySlug
      ? routes.brands({ category: target.categorySlug, sub: target.subcategorySlug })
      : routes.brands({ category: target.categorySlug })

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
