import type { MetadataRoute } from 'next'
import { getBrandSeoEntries } from '@/lib/services/brands'
import { getAllGuides } from '@/lib/services/guides'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'
import { buildAlternates, type Locale } from '@/lib/seo/alternates'
import { getBrandIndexability } from '@/lib/seo/brand-indexability'

export const revalidate = 3600

const ALL_LOCALES: readonly Locale[] = ['zh-TW', 'en']

function localizedEntries(
  path: string,
  availableLocales: readonly Locale[] = ALL_LOCALES,
  lastModified?: Date,
): MetadataRoute.Sitemap {
  return availableLocales.map((locale) => {
    const { canonical, languages } = buildAlternates(path, locale, availableLocales)
    return {
      url: canonical,
      ...(lastModified ? { lastModified } : {}),
      alternates: { languages },
    }
  })
}

function validDate(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function latestBrandDate(
  entries: Array<{ updatedAt: string }>,
): Date | undefined {
  const timestamps = entries
    .map((entry) => validDate(entry.updatedAt)?.getTime())
    .filter((value): value is number => value !== undefined)
  return timestamps.length > 0 ? new Date(Math.max(...timestamps)) : undefined
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages = [
    '/',
    '/brands',
    '/stats',
    '/about',
    '/glossary',
    '/faq',
    '/terms',
    '/privacy',
    '/guides',
    '/getting-started',
    '/submit',
  ].flatMap((path) => localizedEntries(path))

  try {
    const [brands, guideResult] = await Promise.all([
      getBrandSeoEntries(),
      getAllGuides(),
    ])
    const guides = guideResult.ok ? guideResult.guides : []

    const brandPages = brands.flatMap((brand) => {
      const indexability = getBrandIndexability(brand)
      const availableLocales: Locale[] = [
        ...(indexability['zh-TW'] ? (['zh-TW'] as const) : []),
        ...(indexability.en ? (['en'] as const) : []),
      ]
      return localizedEntries(
        `/brands/${brand.slug}`,
        availableLocales,
        validDate(brand.updatedAt),
      )
    })

    const categoryPages = PRODUCT_TYPE_CATEGORIES.flatMap((category) => {
      const categoryBrands = brands.filter(
        (brand) => brand.productType === category.slug,
      )
      return localizedEntries(
        `/brands?category=${category.slug}`,
        ALL_LOCALES,
        latestBrandDate(categoryBrands),
      )
    })

    const guidePages = guides.flatMap((guide) => {
      const locale: Locale = guide.frontmatter.locale === 'en' ? 'en' : 'zh-TW'
      return localizedEntries(
        `/guides/${guide.frontmatter.slug}`,
        [locale],
        validDate(guide.frontmatter.updatedAt || guide.frontmatter.publishedAt),
      )
    })

    return [...staticPages, ...categoryPages, ...brandPages, ...guidePages]
  } catch {
    return staticPages
  }
}
