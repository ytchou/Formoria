import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { getBrands } from '@/lib/services/brands'
import { getTags, getActiveCategories } from '@/lib/services/taxonomy'
import { buildCategoryItemListJsonLd, buildBreadcrumbJsonLd } from '@/lib/json-ld'
import type { BreadcrumbItem } from '@/lib/json-ld'
import { parsePageParam, parseSortParam, DEFAULT_PAGE_SIZE } from '@/lib/pagination'
import { BrandGrid } from '@/components/brands/brand-grid'
import { Pagination } from '@/components/brands/pagination'

// ISR: revalidate every hour
export const revalidate = 3600

export async function generateStaticParams() {
  try {
    const categories = await getActiveCategories()
    return categories.map(({ slug }) => ({ category: slug }))
  } catch {
    return []
  }
}

type PageProps = {
  params: Promise<{ locale: string; category: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, category: slug } = await params
  setRequestLocale(locale)
  const t = await getTranslations('categories')

  try {
    const tags = await getTags('product_type')
    const tag = tags.find((t) => t.slug === slug)
    if (!tag) return { title: t('notFoundTitle') }

    const displayName = tag.nameZh ?? tag.name
    const title = t('metadata.title', { displayName })
    const description = t('metadata.description', { displayName, name: tag.name })
    return {
      title,
      description,
      alternates: { canonical: `/categories/${slug}` },
      openGraph: {
        title,
        description,
      },
      twitter: {
        title,
        description,
      },
    }
  } catch {
    return { title: t('notFoundTitle') }
  }
}

export default async function CategoryPage({ params, searchParams }: PageProps) {
  const { locale, category: slug } = await params
  setRequestLocale(locale)
  const t = await getTranslations('categories')

  const sp = await searchParams

  const page = parsePageParam(sp.page as string | undefined)
  const sort = parseSortParam(sp.sort as string | undefined)

  // Parallel fetch: brands for this category + all product_type tags (to find display name)
  const [{ brands, totalCount }, allTags] = await Promise.all([
    getBrands({
      tags: [slug],
      status: 'approved',
      sort,
      limit: DEFAULT_PAGE_SIZE,
      offset: (page - 1) * DEFAULT_PAGE_SIZE,
    }),
    getTags('product_type'),
  ])

  // Find the matching tag for this category slug
  const tag = allTags.find((t) => t.slug === slug)
  if (!tag) notFound()

  const categoryName = tag.nameZh ?? tag.name

  // Pagination params (excluding page)
  const paginationParams: Record<string, string> = {}
  if (sort !== 'name') paginationParams.sort = sort

  const totalPages = Math.ceil(totalCount / DEFAULT_PAGE_SIZE)
  const clampedPage = totalCount > 0 && page > totalPages ? totalPages : page

  // Re-fetch if page was clamped
  let displayBrands = brands
  if (clampedPage !== page && totalCount > 0) {
    const refetched = await getBrands({
      tags: [slug],
      status: 'approved',
      sort,
      limit: DEFAULT_PAGE_SIZE,
      offset: (clampedPage - 1) * DEFAULT_PAGE_SIZE,
    })
    displayBrands = refetched.brands
  }

  // Breadcrumb items
  const breadcrumbItems: BreadcrumbItem[] = [
    { label: t('breadcrumbHome'), href: '/' },
    { label: categoryName },
  ]

  // JSON-LD data for brands on the current page
  const brandSummaries = displayBrands.map((b) => ({ name: b.name, slug: b.slug }))

  const plural = totalCount !== 1 ? 's' : ''

  return (
    <main className="mx-auto w-full max-w-screen-xl px-6 py-10 md:px-10">
      {/* JSON-LD structured data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(buildCategoryItemListJsonLd(categoryName, slug, brandSummaries)),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(buildBreadcrumbJsonLd(breadcrumbItems)),
        }}
      />

      {/* Breadcrumb navigation */}
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-[#7C7570]">
        <ol className="flex items-center gap-1.5">
          <li>
            <Link href="/" className="hover:text-[#8B5E3C]">
              {t('breadcrumbHome')}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-[#1A1918]">{categoryName}</li>
        </ol>
      </nav>

      {/* Category header */}
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <h1 className="font-[family-name:var(--font-heading)] text-2xl font-bold leading-tight text-foreground">
            {categoryName}
          </h1>
          <span className="rounded-full bg-[#F5F4F1] px-3 py-0.5 text-sm text-[#7C7570]">
            {t('brandCount', { count: totalCount, plural })}
          </span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('description', { category: tag.name.toLowerCase() })}
        </p>
      </div>

      {/* Brand grid */}
      <BrandGrid brands={displayBrands} />

      {/* Pagination */}
      <Pagination
        totalCount={totalCount}
        currentPage={clampedPage}
        pageSize={DEFAULT_PAGE_SIZE}
        searchParams={paginationParams}
      />
    </main>
  )
}
