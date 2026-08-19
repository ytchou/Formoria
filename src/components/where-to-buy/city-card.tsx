import { Link } from '@/i18n/navigation'
import { taxonomyLinkClasses, toggleChipRowClasses } from '@/components/ui/toggle-chip'
import { cn } from '@/lib/utils'
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
      {/* The 36px chip primitive, not a hand-rolled 32px pill: the chip owns
          its own 14px gap, which is what keeps the touch-target exception
          honest whatever this row's parent does. */}
      <ul className={cn('mt-3', toggleChipRowClasses)}>
        {summary.districts.map((district) => (
          <li key={district.slug}>
            <Link href={`${cityPath}#${district.slug}`} className={taxonomyLinkClasses()}>
              {districtNames[district.slug] ?? district.name} · {district.count}
            </Link>
          </li>
        ))}
      </ul>
    </article>
  )
}
