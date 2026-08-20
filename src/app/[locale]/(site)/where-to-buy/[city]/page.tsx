import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Breadcrumb } from '@/components/brands/brand-breadcrumb'
import { DistrictSection } from '@/components/where-to-buy/district-section'
import { LocateButton } from '@/components/where-to-buy/locate-button'
import { ChipRow, taxonomyLinkClasses } from '@/components/ui/toggle-chip'
import { localizePath } from '@/i18n/locale-preference'
import { citySlugFromPath, citySlugToPath } from '@/lib/constants/taiwan-cities'
import { buildAlternates, type Locale } from '@/lib/seo/alternates'
import {
  getStockistDirectory,
  groupStockistsForCity,
  resolveStockistCategory,
  stockistDistrictSlugs,
  summarizeStockistCities,
} from '@/lib/services/stockists'
import { L1_CATEGORIES, categoryLabel } from '@/lib/taxonomy/ontology'
import { ViewItemListTracker } from '@/components/analytics/view-item-list-tracker'
import { buildStockistItemListJsonLd, safeJsonLdStringify } from '@/lib/json-ld'
import { captureReadFailure, markRenderDegraded } from '@/lib/degraded-render'
import { routes } from '@/lib/routes'

export const revalidate = 3600

type PageProps = {
  params: Promise<{ locale: string; city: string }>
  searchParams: Promise<{ category?: string | string[] }>
}

function resolveCity(path: string) {
  return citySlugFromPath(path)
}

export async function generateStaticParams() {
  if (process.env.PLAYWRIGHT_TEST === 'true') return []

  try {
    const locations = await getStockistDirectory()
    return summarizeStockistCities(locations).map(({ city }) => ({
      city: citySlugToPath(city),
    }))
  } catch (error) {
    console.error('generateStaticParams(/where-to-buy/[city]) failed:', error)
    return []
  }
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale, city: cityPath } = await params
  const city = resolveCity(cityPath)
  if (!city) return {}
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const [t, tCities] = await Promise.all([
    getTranslations({ locale: safeLocale, namespace: 'whereToBuy' }),
    getTranslations({ locale: safeLocale, namespace: 'cities' }),
  ])
  const path = routes.whereToBuyCity(citySlugToPath(city))
  const { canonical, languages } = buildAlternates(path, safeLocale)
  return {
    title: t('cityTitle', { city: tCities(city) }),
    description: t('metaDescription'),
    alternates: { canonical, languages },
  }
}

export default async function WhereToBuyCityPage({
  params,
  searchParams,
}: PageProps) {
  const { locale, city: cityPath } = await params
  const city = resolveCity(cityPath)
  if (!city) notFound()
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const rawCategory = (await searchParams).category
  const category = resolveStockistCategory(
    Array.isArray(rawCategory) ? rawCategory.at(0) : rawCategory,
  )
  const [t, tCities, tDistricts] = await Promise.all([
    getTranslations({ locale: safeLocale, namespace: 'whereToBuy' }),
    getTranslations({ locale: safeLocale, namespace: 'cities' }),
    getTranslations({ locale: safeLocale, namespace: 'districts' }),
  ])
  const directoryResult = await getStockistDirectory(category).catch(
    captureReadFailure('whereToBuy.city'),
  )
  if (directoryResult === null) await markRenderDegraded('whereToBuy.city')
  const locations = directoryResult ?? []
  const groups = groupStockistsForCity(locations, city)
  const availableDistrictSlugs = stockistDistrictSlugs(locations)
  const count = groups.reduce((sum, group) => sum + group.locations.length, 0)
  const cityName = tCities(city)
  const cityUrl = routes.whereToBuyCity(citySlugToPath(city))
  const canonicalUrl = buildAlternates(cityUrl, safeLocale).canonical
  const jsonLd = buildStockistItemListJsonLd({
    locations: groups.flatMap((group) => group.locations),
    cityName,
    canonicalUrl,
  })

  return (
    // NO `id="main-content"` HERE. The (site) layout already puts that id on
    // the wrapper it renders around every route, so a second one on this
    // `<main>` made the document carry two — invalid, and the skip link
    // (`root-document.tsx`) resolves to the FIRST match, which meant these two
    // routes alone skipped to a different element than every other route. One
    // id per document, and it is the layout's.
    <main className="page-gutter mx-auto w-full page-measure pt-12 pb-section">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(jsonLd) }}
      />
      <Breadcrumb
        ariaLabel={t('breadcrumbLabel')}
        items={[
          { label: t('directory'), href: routes.whereToBuy() },
          { label: cityName },
        ]}
      />
      <header className="max-w-3xl">
        <h1 className="type-page-title text-ink">
          {t('cityTitle', { city: cityName })}
        </h1>
        <p className="mt-4 type-body text-ink-muted">
          {t('cityDescription', { city: cityName, count })}
        </p>
        <div className="mt-6">
          <LocateButton
            availableDistrictSlugs={availableDistrictSlugs}
            copy={{
              idle: t('useLocation'),
              locating: t('locating'),
              denied: t('locationDenied'),
              unavailable: t('locationUnavailable'),
            }}
          />
        </div>
      </header>

      <nav aria-label={t('categoryNavLabel')} className="mt-stack">
        <ChipRow as="ul">
          <li>
            <a
              href={localizePath(cityUrl, safeLocale)}
              className={taxonomyLinkClasses({ active: !category })}
            >
              {t('allCategories')}
            </a>
          </li>
          {L1_CATEGORIES.map((item) => (
            <li key={item.slug}>
              <a
                href={localizePath(
                  `${cityUrl}?category=${item.slug}`,
                  safeLocale,
                )}
                className={taxonomyLinkClasses({
                  active: category === item.slug,
                })}
              >
                {categoryLabel(item, safeLocale)}
              </a>
            </li>
          ))}
        </ChipRow>
      </nav>

      <div className="mt-stack">
        {count > 0 ? (
          <ViewItemListTracker
            listName={`where-to-buy-${city}`}
            itemCount={count}
            stockists
          />
        ) : null}
        {groups.length > 0 ? (
          groups.map((group) => (
            <DistrictSection
              key={group.slug}
              group={group}
              label={group.name ? tDistricts(group.slug) : t('unassigned')}
              locationLabel={t('locations')}
              mapsLabel={t('maps')}
            />
          ))
        ) : (
          <p className="rounded-[3px] border border-rule bg-surface p-6 type-body-sm">
            {t('empty')}
          </p>
        )}
      </div>
    </main>
  )
}
