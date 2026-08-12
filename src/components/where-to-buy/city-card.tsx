import { Link } from '@/i18n/navigation'
import { citySlugToPath } from '@/lib/constants/taiwan-cities'
import type { StockistCitySummary } from '@/lib/services/brand-channels'

export function CityCard({ summary, cityName, districtNames, locationLabel }: { summary: StockistCitySummary; cityName: string; districtNames: Record<string, string>; locationLabel: string }) {
  const cityPath = `/where-to-buy/${citySlugToPath(summary.city)}`
  return (
    <article className="border-t border-border py-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="type-card-title text-foreground">
          <Link href={cityPath} className="hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-primary">{cityName}</Link>
        </h2>
        <span className="type-caption text-muted-foreground">{summary.count} {locationLabel}</span>
      </div>
      <ul className="mt-3 flex flex-wrap gap-2">
        {summary.districts.map((district) => (
          <li key={district.slug}>
            <Link href={`${cityPath}#${district.slug}`} className="inline-flex min-h-8 items-center rounded-full border border-border px-3 type-caption hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-primary">
              {districtNames[district.slug] ?? district.name} · {district.count}
            </Link>
          </li>
        ))}
      </ul>
    </article>
  )
}
