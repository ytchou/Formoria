import { StockistRow } from './stockist-row'
import type { StockistDistrictGroup } from '@/lib/services/stockists'

export function DistrictSection({
  group,
  label,
  locationLabel,
  mapsLabel,
}: {
  group: StockistDistrictGroup
  label: string
  locationLabel: string
  mapsLabel: string
}) {
  const byBrand = Map.groupBy(group.locations, (location) => location.brandSlug)
  return (
    <section className="scroll-mt-24 border-t border-rule py-stack">
      <h2
        id={group.slug}
        tabIndex={-1}
        className="type-card-title text-ink focus:outline-2 focus:outline-offset-3 focus:outline-accent"
      >
        {label} · {group.locations.length} {locationLabel}
      </h2>
      <div className="mt-6 space-y-8">
        {[...byBrand.entries()].map(([brandSlug, locations]) => (
          <section key={brandSlug}>
            <h3 className="type-label">{locations.at(0)?.brandName}</h3>
            {/* No card around the rows. Each row draws its own hairline, so a
                box here would be a second, redundant edge — elevation in v2 is
                the rule, and one rule is enough. */}
            <ul className="mt-2">
              {locations.map((location) => (
                <StockistRow
                  key={location.id}
                  location={location}
                  mapsLabel={mapsLabel}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  )
}
