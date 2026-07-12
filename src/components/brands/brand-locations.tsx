import { ExternalLink, MapPin } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { BrandLocationsMap } from './brand-locations-map'
import {
  getLocationMapQuery,
  hasLocationCoordinates,
  isMappableRetailLocation,
  normalizeRetailLocations,
} from '@/lib/brands/locations'
import type { Brand, RetailLocation } from '@/lib/types'

interface BrandLocationsProps {
  brand: Brand
}

type LocationTranslator = (key: string) => string

function getMapsHref(location: RetailLocation): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    getLocationMapQuery(location),
  )}`
}

function LocationCard({
  location,
  t,
}: {
  location: RetailLocation
  t: LocationTranslator
}) {
  const relationshipType = location.relationshipType ?? 'stockist'
  const networkType = location.type ?? 'unclassified'

  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <MapPin
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="type-subsection-title">{location.name}</h4>
            <Badge variant="secondary">
              {t(`locations.types.${relationshipType}`)}
            </Badge>
            <Badge variant={networkType === 'chain' ? 'outline' : 'secondary'}>
              {t(`locations.networkTypes.${networkType}`)}
            </Badge>
            {!hasLocationCoordinates(location) ? (
              <Badge variant="outline">{t('locations.manualAddress')}</Badge>
            ) : null}
          </div>

          {location.venueName ? (
            <p className="mt-1 type-card-description">
              {location.venueName}
              {location.floorOrCounter ? ` - ${location.floorOrCounter}` : ''}
            </p>
          ) : location.floorOrCounter ? (
            <p className="mt-1 type-card-description">
              {location.floorOrCounter}
            </p>
          ) : null}

          {location.address ? (
            <p className="mt-1 type-card-description">{location.address}</p>
          ) : null}

          {location.availabilityNote ? (
            <p className="mt-2 type-field-value">
              {location.availabilityNote}
            </p>
          ) : (
            <p className="mt-2 type-card-description">
              {t(`locations.defaultNotes.${relationshipType}`)}
            </p>
          )}

          <a
            href={getMapsHref(location)}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "secondary", className: "mt-3" })}
          >
            {t('locations.openInMaps')}
            <ExternalLink aria-hidden="true" className="size-4" />
          </a>
        </div>
      </div>
    </article>
  )
}

function LocationCards({
  locations,
  t,
}: {
  locations: RetailLocation[]
  t: LocationTranslator
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {locations.map((location, index) => (
        <LocationCard
          key={`${location.name}-${location.address}-${index}`}
          location={location}
          t={t}
        />
      ))}
    </div>
  )
}

export function BrandLocations({ brand }: BrandLocationsProps) {
  const t = useTranslations('brandDetail')
  const locations = normalizeRetailLocations(brand.retailLocations)
  const mappedLocations = locations.filter(isMappableRetailLocation)
  const independentWithoutCoordinates = locations.filter(
    (location) =>
      location.type === 'independent' && !isMappableRetailLocation(location),
  )
  const chainLocations = locations.filter(
    (location) => location.type === 'chain',
  )
  const unclassifiedLocations = locations.filter(
    (location) => location.type === undefined,
  )

  if (locations.length === 0) return null

  return (
    <section className="space-y-6">
      <div>
        <h2 className="type-card-title">{t('sections.locations')}</h2>
        <p className="mt-1 type-card-description">
          {t('locations.subheading')}
        </p>
      </div>

      {mappedLocations.length > 0 ? (
        <div className="space-y-3">
          <div>
            <h3 className="type-subsection-title">
              {t('locations.mapHeading')}
            </h3>
            <p className="mt-1 type-card-description">
              {t('locations.mapDescription')}
            </p>
          </div>
          <BrandLocationsMap
            locations={mappedLocations}
            mapTitle={t('locations.mapTitle', { name: brand.name })}
          />
          <LocationCards locations={mappedLocations} t={t} />
        </div>
      ) : null}

      {independentWithoutCoordinates.length > 0 ? (
        <div className="space-y-3">
          <div>
            <h3 className="type-subsection-title">
              {t('locations.independentHeading')}
            </h3>
            <p className="mt-1 type-card-description">
              {t('locations.independentDescription')}
            </p>
          </div>
          <LocationCards locations={independentWithoutCoordinates} t={t} />
        </div>
      ) : null}

      {chainLocations.length > 0 ? (
        <div className="space-y-3">
          <div>
            <h3 className="type-subsection-title">
              {t('locations.chainHeading')}
            </h3>
            <p className="mt-1 type-card-description">
              {t('locations.chainDescription')}
            </p>
          </div>
          <LocationCards locations={chainLocations} t={t} />
        </div>
      ) : null}

      {unclassifiedLocations.length > 0 ? (
        <div className="space-y-3">
          <div>
            <h3 className="type-subsection-title">
              {t('locations.unclassifiedHeading')}
            </h3>
            <p className="mt-1 type-card-description">
              {t('locations.unclassifiedDescription')}
            </p>
          </div>
          <LocationCards locations={unclassifiedLocations} t={t} />
        </div>
      ) : null}
    </section>
  )
}
