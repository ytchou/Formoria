import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { DirectoryView } from '@/components/brands/directory-view'
import { PRODUCT_TYPE_CATEGORIES, categoryLabel } from '@/lib/taxonomy/ontology'
import { parseDirectoryViewFilters, type DirectorySearchParams } from '@/lib/seo/directory-filters'
import { resolveDirectorySeo } from '@/lib/seo/directory-indexation'
import { buildDirectoryCanonicals } from '@/lib/seo/directory-canonical'
import { buildOpenGraph } from '@/lib/seo/open-graph'
import { truncateForMeta } from '@/lib/text/truncate-for-meta'
import type { Locale } from '@/lib/seo/alternates'
import { resolveCategoryRouteParams } from '../../category-params'

export const revalidate = 3600

type SubcategoryPageProps = {
  params: Promise<{ locale: string; category: string; subcategory: string }>
  searchParams: Promise<DirectorySearchParams>
}

export async function generateMetadata({ params, searchParams }: SubcategoryPageProps): Promise<Metadata> {
  const { locale, category: categorySlug, subcategory: subcategorySlug } = await params
  const resolved = resolveCategoryRouteParams({ categorySlug, subcategorySlug })
  if (!resolved) return {}
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const sp = await searchParams
  const { page, sort } = parseDirectoryViewFilters(sp, new Set(PRODUCT_TYPE_CATEGORIES.map((category) => category.slug)))
  const seo = resolveDirectorySeo({
    locale: safeLocale,
    categorySlug: resolved.category.slug,
    subcategorySlug: resolved.subcategory?.slug,
    page,
    facets: {
      search: sp.search,
      price: sp.price,
      verification: sp.verification,
      sort: typeof sp.sort === 'string' ? sp.sort : sort !== 'random' ? sort : undefined,
      category: sp.category,
      sub: sp.sub,
    },
  })
  const catT = await getTranslations({ locale: safeLocale, namespace: 'categories' })
  const categoryName = categoryLabel(resolved.category, safeLocale)
  const subName = safeLocale === 'zh-TW'
    ? resolved.subcategory?.nameZh ?? ''
    : resolved.subcategory?.nameEn ?? ''
  const title = catT('subMetadata.title', { subName, categoryName })
  const description = truncateForMeta(catT('subMetadata.description', { subName, categoryName }))
  const canonical = seo.canonical || buildDirectoryCanonicals({
    locale: safeLocale,
    categorySlug: resolved.category.slug,
    subcategorySlug: resolved.subcategory?.slug,
    page,
  }).canonical
  return {
    title,
    description,
    alternates: { canonical, ...(seo.languages ? { languages: seo.languages } : {}) },
    ...(seo.robots ? { robots: seo.robots } : {}),
    ...buildOpenGraph({
      title,
      description,
      url: canonical,
      locale: safeLocale === 'zh-TW' ? 'zh_TW' : 'en_US',
      alternateLocale: [safeLocale === 'zh-TW' ? 'en_US' : 'zh_TW'],
    }),
  }
}

export default async function SubcategoryPage({ params, searchParams }: SubcategoryPageProps) {
  const { locale, category: categorySlug, subcategory: subcategorySlug } = await params
  const resolved = resolveCategoryRouteParams({ categorySlug, subcategorySlug })
  if (!resolved) notFound()
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const sp = await searchParams
  const parsed = parseDirectoryViewFilters(sp, new Set(PRODUCT_TYPE_CATEGORIES.map((category) => category.slug)))
  return (
    <DirectoryView
      locale={safeLocale}
      filters={{
        ...parsed.filters,
        categorySlugs: [resolved.category.slug],
        subcategorySlugs: resolved.subcategory ? [resolved.subcategory.slug] : [],
      }}
      page={parsed.page}
      sort={parsed.sort}
    />
  )
}

