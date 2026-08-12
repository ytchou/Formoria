import { StockistRow } from './stockist-row'
import type { StockistDistrictGroup } from '@/lib/services/brand-channels'

export function DistrictSection({ group, label, locationLabel, mapsLabel }: { group: StockistDistrictGroup; label: string; locationLabel: string; mapsLabel: string }) {
  const byBrand = Map.groupBy(group.locations, (location) => location.brandSlug)
  return (
    <section className="scroll-mt-24 border-t border-border py-8">
      <h2 id={group.slug} tabIndex={-1} className="type-section-title text-foreground focus:outline-2 focus:outline-offset-3 focus:outline-primary">
        {label} · {group.locations.length} {locationLabel}
      </h2>
      <div className="mt-5 space-y-6">
        {[...byBrand.entries()].map(([brandSlug, locations]) => (
          <section key={brandSlug}>
            <h3 className="type-body-emphasis text-foreground">{locations.at(0)?.brandName}</h3>
            <ul className="mt-2 rounded-lg bg-card px-4">
              {locations.map((location) => <StockistRow key={location.id} location={location} mapsLabel={mapsLabel} />)}
            </ul>
          </section>
        ))}
      </div>
    </section>
  )
}
