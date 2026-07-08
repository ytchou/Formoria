import { ExternalLink, MapPin } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { BrandLocationsMap } from './brand-locations-map'
import {
  getLocationMapQuery,
  hasLocationCoordinates,
  normalizeRetailLocations,
} from '@/lib/brands/locations'
import type { Brand, RetailLocation } from '@/lib/types'

interface BrandLocationsProps {
  brand: Brand
}

function getMapsHref(location: RetailLocation): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    getLocationMapQuery(location),
  )}`
}

export function BrandLocations({ brand }: BrandLocationsProps) {
  const t = useTranslations('brandDetail')
  const locations = normalizeRetailLocations(brand.retailLocations)
  const pinnedCount = locations.filter(hasLocationCoordinates).length

  if (locations.length === 0) return null

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-[family-name:var(--font-heading)] text-lg font-bold text-foreground">
          {t('sections.locations')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('locations.subheading')}
        </p>
      </div>

      {pinnedCount > 0 ? (
        <BrandLocationsMap
          locations={locations}
          mapTitle={t('locations.mapTitle', { name: brand.name })}
        />
      ) : null}

      <div className="grid gap-3">
        {locations.map((location, index) => {
          const relationshipType = location.relationshipType ?? 'stockist'
          return (
            <article
              key={`${location.name}-${location.address}-${index}`}
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-start gap-3">
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">
                      {location.name}
                    </h3>
                    <Badge variant="secondary">
                      {t(`locations.types.${relationshipType}`)}
                    </Badge>
                    {!hasLocationCoordinates(location) ? (
                      <Badge variant="outline">
                        {t('locations.manualAddress')}
                      </Badge>
                    ) : null}
                  </div>

                  {location.venueName ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {location.venueName}
                      {location.floorOrCounter
                        ? ` - ${location.floorOrCounter}`
                        : ''}
                    </p>
                  ) : location.floorOrCounter ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {location.floorOrCounter}
                    </p>
                  ) : null}

                  {location.address ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {location.address}
                    </p>
                  ) : null}

                  {location.availabilityNote ? (
                    <p className="mt-2 text-sm text-foreground">
                      {location.availabilityNote}
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {t(`locations.defaultNotes.${relationshipType}`)}
                    </p>
                  )}

                  <a
                    href={getMapsHref(location)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex min-h-12 items-center gap-1.5 rounded-lg text-sm font-medium text-primary transition-colors hover:text-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {t('locations.openInMaps')}
                    <ExternalLink className="size-4" />
                  </a>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
