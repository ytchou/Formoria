import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { DirectoryView } from '@/components/brands/directory-view'
import { L1_CATEGORIES, categoryLabel, resolveDirectorySubcategorySlugs } from '@/lib/taxonomy/ontology'
import { parseDirectoryViewFilters, type DirectorySearchParams } from '@/lib/seo/directory-filters'
import type { Locale } from '@/lib/seo/alternates'
import { buildOpenGraph } from '@/lib/seo/open-graph'
import { resolveDirectorySeo } from '@/lib/seo/directory-indexation'
import { truncateForMeta } from '@/lib/text/truncate-for-meta'

// Both `generateMetadata` and the page body read `searchParams`, which opts this route
// into dynamic rendering. Keep this value for path revalidation parity.
export const revalidate = 3600

const VALID_CATEGORY_SLUGS = new Set(L1_CATEGORIES.map((category) => category.slug))

interface BrandsPageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<DirectorySearchParams>
}

export async function generateMetadata({ params, searchParams }: BrandsPageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const sp = await searchParams
  const { filters, page } = parseDirectoryViewFilters(sp, VALID_CATEGORY_SLUGS)
  const categorySlug = filters.categorySlugs.length === 1 ? filters.categorySlugs[0] ?? null : null
  const category = categorySlug
    ? L1_CATEGORIES.find((item) => item.slug === categorySlug)
    : undefined
  // No parent-L1 conjunct: `?category=fashion&sub=backpacks` must name the sub
  // it is actually filtering by. `resolveDirectorySeo` still treats the
  // cross-L1 pair as invalid, so the canonical stays `/brands?category=&sub=`
  // and never points at the 404 that `/categories/fashion/backpacks` is.
  const subcategory = resolveDirectorySubcategorySlugs(filters.subcategorySlugs)
  const activeSubcategory = subcategory.length === 1 ? subcategory[0] : undefined
  const ogLocale = safeLocale === 'zh-TW' ? 'zh_TW' : 'en_US'
  const ogAlternateLocale = safeLocale === 'zh-TW' ? 'en_US' : 'zh_TW'
  const seo = resolveDirectorySeo({
    locale: safeLocale,
    surface: 'brands',
    categorySlug: categorySlug,
    subcategorySlug: activeSubcategory?.slug,
    page,
    facets: {
      search: sp.search,
      price: sp.price,
      verification: sp.verification,
      sort: typeof sp.sort === 'string' ? sp.sort : undefined,
      category: sp.category,
      sub: sp.sub,
      material: sp.material,
      multiCategory: filters.categorySlugs.length > 1,
      multiSub: filters.subcategorySlugs.length > 1,
    },
  })

  if (category) {
    const catT = await getTranslations({ locale: safeLocale, namespace: 'categories' })
    const displayName = categoryLabel(category, safeLocale)
    const subName = activeSubcategory
      ? safeLocale === 'zh-TW' ? activeSubcategory.nameZh : activeSubcategory.nameEn
      : undefined
    const landingKey = activeSubcategory
      ? `l2.${activeSubcategory.slug}`
      : `l1.${category.slug}`
    const description = truncateForMeta(subName
      ? catT.has(`${landingKey}.description`)
        ? catT(`${landingKey}.description`)
        : catT('subMetadata.description', { subName, categoryName: displayName })
      : catT.has(`${landingKey}.description`)
        ? catT(`${landingKey}.description`)
        : catT.has(`descriptions.${category.slug}`)
          ? catT(`descriptions.${category.slug}`)
          : catT('metadata.description', { displayName, name: category.name }))
    const title = subName
      ? catT.has(`${landingKey}.title`)
        ? catT(`${landingKey}.title`)
        : catT('subMetadata.title', { subName, categoryName: displayName })
      : catT.has(`${landingKey}.title`)
        ? catT(`${landingKey}.title`)
        : catT('metadata.title', { displayName })
    const canonical = seo.canonical
    const languages = seo.languages

    return {
      title: { absolute: title },
      description,
      alternates: { canonical, ...(languages ? { languages } : {}) },
      ...(seo.robots ? { robots: seo.robots } : {}),
      ...buildOpenGraph({
        title,
        description,
        url: canonical,
        locale: ogLocale,
        alternateLocale: [ogAlternateLocale],
      }),
    }
  }

  const brandsT = await getTranslations({ locale: safeLocale, namespace: 'brands' })
  const canonical = seo.canonical
  const languages = seo.languages
  return {
    title: { absolute: brandsT('metadata.title') },
    description: brandsT('metadata.description'),
    alternates: { canonical, ...(languages ? { languages } : {}) },
    ...(seo.robots ? { robots: seo.robots } : {}),
    ...buildOpenGraph({
      title: brandsT('metadata.title'),
      description: brandsT('metadata.description'),
      url: canonical,
      locale: ogLocale,
      alternateLocale: [ogAlternateLocale],
    }),
  }
}

export default async function BrandsPage({ params, searchParams }: BrandsPageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const sp = await searchParams
  const { filters, page, sort } = parseDirectoryViewFilters(sp, VALID_CATEGORY_SLUGS)
  const categorySlug = filters.categorySlugs.length === 1 ? filters.categorySlugs[0] ?? null : null
  const resolvedSubcategories = resolveDirectorySubcategorySlugs(filters.subcategorySlugs)
  const activeSubcategory = resolvedSubcategories.length === 1 ? resolvedSubcategories.at(0) : undefined
  const directorySeo = resolveDirectorySeo({
    locale: safeLocale,
    surface: 'brands',
    categorySlug,
    subcategorySlug: activeSubcategory?.slug,
    page,
    facets: {
      search: sp.search,
      price: sp.price,
      verification: sp.verification,
      sort: typeof sp.sort === 'string' ? sp.sort : sort !== 'random' ? sort : undefined,
      category: sp.category,
      sub: sp.sub,
      material: sp.material,
      multiCategory: filters.categorySlugs.length > 1,
      multiSub: filters.subcategorySlugs.length > 1,
    },
  })

  return <DirectoryView locale={safeLocale} filters={filters} page={page} sort={sort} canonical={directorySeo.canonical} />
}
