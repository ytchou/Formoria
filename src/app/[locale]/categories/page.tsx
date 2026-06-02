import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { getActiveCategories } from '@/lib/services/taxonomy'
import { getBrands } from '@/lib/services/brands'
import { buildBreadcrumbJsonLd } from '@/lib/json-ld'
import type { BreadcrumbItem } from '@/lib/json-ld'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'

// ISR: revalidate every hour (matches [category] page)
export const revalidate = 3600

type PageProps = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const t = await getTranslations('categories')

  const title = t('index.metadata.title')
  const description = t('index.metadata.description')
  const { canonical, languages } = buildAlternates('/categories', safeLocale)
  const ogLocale = safeLocale === 'zh-TW' ? 'zh_TW' : 'en_US'
  const ogAlternateLocale = safeLocale === 'zh-TW' ? 'en_US' : 'zh_TW'

  return {
    title,
    description,
    alternates: { canonical, languages },
    openGraph: {
      title,
      description,
      locale: ogLocale,
      alternateLocale: [ogAlternateLocale],
    },
    twitter: {
      title,
      description,
    },
  }
}

export default async function CategoriesIndexPage({ params }: PageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const t = await getTranslations('categories')

  // Fetch all active categories (those with ≥1 approved brand)
  const categories = await getActiveCategories()

  // Fetch per-category brand counts in parallel (limit:1 minimises data transfer)
  const countResults = await Promise.all(
    categories.map((cat) =>
      getBrands({ tags: [cat.slug], status: 'approved', limit: 1 }).then((r) => r.totalCount),
    ),
  )

  const categoriesWithCounts = categories.map((cat, i) => ({
    ...cat,
    count: countResults[i] ?? 0,
  }))

  // Breadcrumb JSON-LD: Home → Categories
  const breadcrumbItems: BreadcrumbItem[] = [
    { label: t('breadcrumbHome'), href: '/' },
    { label: t('index.heading') },
  ]

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  const categoriesItemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: t('index.heading'),
    url: `${siteUrl}/categories`,
    inLanguage: safeLocale === 'zh-TW' ? 'zh-TW' : 'en',
    numberOfItems: categoriesWithCounts.length,
    itemListElement: categoriesWithCounts.map((cat, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: safeLocale === 'zh-TW' ? (cat.nameZh ?? cat.name) : cat.name,
      url: `${siteUrl}/categories/${cat.slug}`,
    })),
  }

  return (
    <main className="mx-auto w-full max-w-screen-xl px-6 py-10 md:px-10">
      {/* JSON-LD structured data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(categoriesItemListJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(buildBreadcrumbJsonLd(breadcrumbItems, safeLocale)),
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
          <li className="text-[#1A1918]">{t('index.heading')}</li>
        </ol>
      </nav>

      {/* Page header */}
      <div className="mb-10">
        <h1 className="font-[family-name:var(--font-heading)] text-2xl font-bold leading-tight text-foreground">
          {t('index.heading')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('index.subheading')}</p>
      </div>

      {/* Category grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {categoriesWithCounts.map((cat) => {
          const displayName = safeLocale === 'zh-TW' ? (cat.nameZh ?? cat.name) : cat.name
          return (
            <Link
              key={cat.slug}
              href={`/categories/${cat.slug}`}
              className="group flex flex-col rounded-xl border border-[#E8E5E0] bg-white p-5 transition-all hover:-translate-y-px hover:border-[#D0CCC7] hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="text-sm font-semibold leading-snug text-foreground group-hover:text-[#8B5E3C]">
                {displayName}
              </span>
              <span className="mt-2 text-xs text-[#7C7570]">
                {t('brandCount', { count: cat.count })}
              </span>
            </Link>
          )
        })}
      </div>
    </main>
  )
}
