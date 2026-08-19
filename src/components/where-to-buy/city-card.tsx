import { Link } from '@/i18n/navigation'
import { ChipRow, taxonomyLinkClasses } from '@/components/ui/toggle-chip'
import { citySlugToPath } from '@/lib/constants/taiwan-cities'
import type { StockistCitySummary } from '@/lib/services/brand-channels'
import { routes } from '@/lib/routes'

export function CityCard({
  summary,
  cityName,
  districtNames,
  locationLabel,
}: {
  summary: StockistCitySummary
  cityName: string
  districtNames: Record<string, string>
  locationLabel: string
}) {
  const cityPath = routes.whereToBuyCity(citySlugToPath(summary.city))
  return (
    <article className="border-t border-rule py-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="type-card-title text-ink">
          <Link
            href={cityPath}
            className="hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent"
          >
            {cityName}
          </Link>
        </h2>
        <span className="type-metadata text-ink-muted">
          {summary.count} {locationLabel}
        </span>
      </div>
      {/* The 36px chip primitive, not a hand-rolled 32px pill, and a
          `ChipRow` rather than a hand-rolled flex row: the row owns the 14px
          gap that keeps the touch-target exception honest. `mt-3` survives
          here — under the old negative-margin row it was silently dropped by
          tailwind-merge, and these chips butted against the count line. */}
      <ChipRow as="ul" className="mt-3">
        {summary.districts.map((district) => (
          <li key={district.slug}>
            <Link href={`${cityPath}#${district.slug}`} className={taxonomyLinkClasses()}>
              {districtNames[district.slug] ?? district.name} · {district.count}
            </Link>
          </li>
        ))}
      </ChipRow>
    </article>
  )
}
