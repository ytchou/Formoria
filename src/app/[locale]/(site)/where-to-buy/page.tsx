import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { CityCard } from '@/components/where-to-buy/city-card'
import { LocateButton } from '@/components/where-to-buy/locate-button'
import { buildAlternates, type Locale } from '@/lib/seo/alternates'
import {
  getStockistDirectory,
  stockistDistrictSlugs,
  summarizeStockistCities,
} from '@/lib/services/brand-channels'
import { captureReadFailure, markRenderDegraded } from '@/lib/degraded-render'
import { ViewItemListTracker } from '@/components/analytics/view-item-list-tracker'
import { routes } from '@/lib/routes'

export const revalidate = 3600

type PageProps = { params: Promise<{ locale: string }> }

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale } = await params
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const t = await getTranslations({
    locale: safeLocale,
    namespace: 'whereToBuy',
  })
  const { canonical, languages } = buildAlternates(routes.whereToBuy(), safeLocale)
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    alternates: { canonical, languages },
  }
}

export default async function WhereToBuyPage({ params }: PageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const [t, tCities, tDistricts] = await Promise.all([
    getTranslations({ locale: safeLocale, namespace: 'whereToBuy' }),
    getTranslations({ locale: safeLocale, namespace: 'cities' }),
    getTranslations({ locale: safeLocale, namespace: 'districts' }),
  ])
  const directoryResult = await getStockistDirectory().catch(
    captureReadFailure('whereToBuy.index'),
  )
  if (directoryResult === null) await markRenderDegraded('whereToBuy.index')
  const locations = directoryResult ?? []
  const cities = summarizeStockistCities(locations)
  const availableDistrictSlugs = stockistDistrictSlugs(locations)
  const overseas = locations.filter((location) => location.country !== 'TW')
  const countryCounts = Map.groupBy(
    overseas,
    (location) => location.country ?? 'XX',
  )
  const districtNames = Object.fromEntries(
    cities.flatMap((city) =>
      city.districts.map((district) => [
        district.slug,
        tDistricts(district.slug),
      ]),
    ),
  )
  const countryNames = new Intl.DisplayNames([safeLocale], { type: 'region' })

  return (
    // NO `id="main-content"` HERE. The (site) layout already puts that id on
    // the wrapper it renders around every route, so a second one on this
    // `<main>` made the document carry two — invalid, and the skip link
    // (`root-document.tsx`) resolves to the FIRST match, which meant these two
    // routes alone skipped to a different element than every other route. One
    // id per document, and it is the layout's.
    <main className="page-gutter mx-auto w-full page-measure pt-12 pb-section">
      <header className="max-w-3xl">
        <p className="type-eyebrow text-accent">Formoria</p>
        <h1 className="mt-3 type-page-title text-ink">
          {t('indexTitle')}
        </h1>
        <p className="mt-4 type-body text-ink-muted">
          {t('indexIntro')}
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

      <div className="mt-stack">
        {locations.length > 0 ? (
          <ViewItemListTracker
            listName="where-to-buy-index"
            itemCount={locations.length}
            stockists
          />
        ) : null}
        {cities.map((summary) => (
          <CityCard
            key={summary.city}
            summary={summary}
            cityName={tCities(summary.city)}
            districtNames={districtNames}
            locationLabel={t('locations')}
          />
        ))}
      </div>

      {overseas.length > 0 ? (
        <section className="mt-section rounded-[3px] border border-rule bg-surface p-6 sm:p-8">
          <h2 className="type-card-title text-ink">
            {t('overseasTitle')}
          </h2>
          <p className="mt-2 type-body-sm">
            {t('overseasDescription', {
              count: overseas.length,
              countries: countryCounts.size,
            })}
          </p>
          <ul className="mt-5 grid gap-2 sm:grid-cols-2 md:grid-cols-3">
            {[...countryCounts.entries()]
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([country, rows]) => (
                <li
                  key={country}
                  className="flex justify-between gap-3 border-t border-rule py-2 type-metadata"
                >
                  <span>{countryNames.of(country) ?? country}</span>
                  <span className="text-ink-muted">{rows.length}</span>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </main>
  )
}
