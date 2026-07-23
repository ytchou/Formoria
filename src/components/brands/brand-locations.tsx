import { ExternalLink } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { SurfaceCard } from '@/components/ui/card'
import {
  isPublicRetailLocation,
  isRetailChainChannel,
  isUnconfirmedRetailLocation,
  normalizeRetailLocations,
} from '@/lib/brands/locations'
import type { Brand, RetailLocation } from '@/lib/types'
import { ConfirmedLocationExplorer } from './confirmed-location-explorer'

interface BrandLocationsProps {
  brand: Brand & { retailLocations?: unknown }
}

type LocationTranslator = (key: string) => string
type RetailChainChannel = Extract<RetailLocation, { kind: 'retail_chain' }>

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function UnconfirmedLocationCards({
  locations,
  t,
}: {
  locations: RetailLocation[]
  t: LocationTranslator
}) {
  return (
    <div className='grid gap-3 sm:grid-cols-2'>
      {locations.map((location, index) => {
        if (location.kind !== 'location') return null

        return (
          <SurfaceCard
            key={`${location.name}-${index}`}
            padding='sm'
            className='h-full'
          >
            <h4 className='type-subsection-title'>{location.name}</h4>
            <div className='mt-2 flex flex-wrap gap-2'>
              <Badge variant='warning'>{t('locations.unconfirmedStatus')}</Badge>
            </div>
          </SurfaceCard>
        )
      })}
    </div>
  )
}

function ChainCards({
  locations,
  t,
}: {
  locations: RetailChainChannel[]
  t: LocationTranslator
}) {
  return (
    <div className='grid gap-3 sm:grid-cols-2'>
      {locations.map((location, index) => {
        const retailerUrl =
          location.retailerUrl && isHttpUrl(location.retailerUrl)
            ? location.retailerUrl
            : undefined

        return (
          <SurfaceCard
            key={`${location.name}-${index}`}
            padding='sm'
            className='h-full'
          >
            <h4 className='type-subsection-title'>{location.name}</h4>
            <div className='mt-2 flex flex-wrap gap-2'>
              <Badge variant='outline'>{t('locations.someStoresBadge')}</Badge>
            </div>
            {retailerUrl ? (
              <a
                href={retailerUrl}
                target='_blank'
                rel='noopener noreferrer'
                className={buttonVariants({
                  variant: 'secondary',
                  className: 'mt-3 min-h-12',
                })}
              >
                {t('locations.retailerWebsite')}
                <ExternalLink aria-hidden='true' className='size-4' />
              </a>
            ) : null}
          </SurfaceCard>
        )
      })}
    </div>
  )
}

export function BrandLocations({ brand }: BrandLocationsProps) {
  const t = useTranslations('brandDetail')
  const locations = normalizeRetailLocations(brand.retailLocations)
  const addressedLocations = locations.filter(isPublicRetailLocation)
  const unaddressedLocations = locations.filter(
    (location) => isUnconfirmedRetailLocation(location) && !isPublicRetailLocation(location),
  )
  const chainLocations = locations.filter(isRetailChainChannel)

  if (locations.length === 0) return null

  const explorerLabels = {
    filterAll: t('locations.filters.all'),
    filterBrandStores: t('locations.filters.brandStores'),
    filterOtherSales: t('locations.filters.otherSales'),
    mapView: t('locations.views.map'),
    viewAll: t('locations.views.viewAll'),
    mapTitle: t('locations.mapTitle', { name: brand.name }),
    mapLoading: t('locations.mapLoading'),
    zoomIn: t('locations.zoomIn'),
    zoomOut: t('locations.zoomOut'),
    openInMaps: t('locations.openInMaps'),
    relationshipBrandStore: t('locations.types.brand_store'),
    relationshipStockist: t('locations.types.stockist'),
    relationshipDepartmentCounter: t('locations.types.department_counter'),
    defaultNoteBrandStore: t('locations.defaultNotes.brand_store'),
    defaultNoteStockist: t('locations.defaultNotes.stockist'),
    defaultNoteDepartmentCounter: t(
      'locations.defaultNotes.department_counter',
    ),
    unconfirmedStatus: t('locations.unconfirmedStatus'),
  }

  return (
    <section className='space-y-8'>
      <h2 className='type-card-title'>
        {t('sections.locationsAndRetailChannels')}
      </h2>

      {addressedLocations.length > 0 ? (
        <div className='space-y-3'>
          <div>
            <h3 className='type-subsection-title'>
              {t('locations.locationHeading')} · {addressedLocations.length}
            </h3>
            <p className='mt-1 type-card-description'>
              {addressedLocations.some(
                (location) => location.confirmationStatus !== 'owner_confirmed',
              )
                ? t('locations.verifiedDisclaimer')
                : t('locations.stockDisclaimer')}
            </p>
          </div>
          <ConfirmedLocationExplorer
            locations={addressedLocations}
            labels={explorerLabels}
          />
        </div>
      ) : null}

      {unaddressedLocations.length > 0 ? (
        <div className='space-y-3'>
          <div>
            <h3 className='type-subsection-title'>
              {t('locations.unconfirmedHeading')} ·{' '}
              {unaddressedLocations.length}
            </h3>
            <p className='mt-1 type-card-description'>
              {t('locations.unconfirmedDisclaimer')}
            </p>
          </div>
          <UnconfirmedLocationCards locations={unaddressedLocations} t={t} />
        </div>
      ) : null}

      {chainLocations.length > 0 ? (
        <div className='space-y-3'>
          <div>
            <h3 className='type-subsection-title'>
              {t('locations.chainHeading')} · {chainLocations.length}
            </h3>
            <p className='mt-1 type-card-description'>
              {t('locations.chainDescription')}
            </p>
          </div>
          <ChainCards locations={chainLocations} t={t} />
        </div>
      ) : null}
    </section>
  )
}
