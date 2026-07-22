'use client'

import { ExternalLink, MapPin } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { SurfaceCard } from '@/components/ui/card'
import {
  getLocationMapQuery,
  isMappableRetailLocation,
} from '@/lib/brands/locations'
import type { RetailLocation } from '@/lib/types'
import { BrandLocationsMap } from './brand-locations-map'

type ConfirmedLocation = Extract<RetailLocation, { kind: 'location' }> & {
  address: string
  confirmationStatus: 'owner_confirmed'
}

type LocationFilter = 'all' | 'brand-stores' | 'other-sales'
type ViewMode = 'map' | 'list'

export interface ConfirmedLocationExplorerLabels {
  filterAll: string
  filterBrandStores: string
  filterOtherSales: string
  mapView: string
  viewAll: string
  mapTitle: string
  mapLoading: string
  openInMaps: string
  relationshipBrandStore: string
  relationshipStockist: string
  relationshipDepartmentCounter: string
  defaultNoteBrandStore: string
  defaultNoteStockist: string
  defaultNoteDepartmentCounter: string
}

interface ConfirmedLocationExplorerProps {
  locations: ConfirmedLocation[]
  labels: ConfirmedLocationExplorerLabels
}

function matchesFilter(
  location: ConfirmedLocation,
  filter: LocationFilter,
): boolean {
  if (filter === 'all') return true
  if (filter === 'brand-stores') {
    return location.relationshipType === 'brand_store'
  }
  return location.relationshipType !== 'brand_store'
}

function getMapsHref(location: ConfirmedLocation): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    getLocationMapQuery(location),
  )}`
}

function getRelationshipLabel(
  location: ConfirmedLocation,
  labels: ConfirmedLocationExplorerLabels,
): string {
  if (location.relationshipType === 'brand_store') {
    return labels.relationshipBrandStore
  }
  if (location.relationshipType === 'department_counter') {
    return labels.relationshipDepartmentCounter
  }
  return labels.relationshipStockist
}

function getDefaultNote(
  location: ConfirmedLocation,
  labels: ConfirmedLocationExplorerLabels,
): string {
  if (location.relationshipType === 'brand_store') {
    return labels.defaultNoteBrandStore
  }
  if (location.relationshipType === 'department_counter') {
    return labels.defaultNoteDepartmentCounter
  }
  return labels.defaultNoteStockist
}

function ConfirmedLocationRow({
  location,
  labels,
}: {
  location: ConfirmedLocation
  labels: ConfirmedLocationExplorerLabels
}) {
  return (
    <SurfaceCard padding='sm' className='h-full'>
      <div className='flex items-start gap-3'>
        <MapPin
          aria-hidden='true'
          className='mt-0.5 size-4 shrink-0 text-muted-foreground'
        />
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-2'>
            <h4 className='type-subsection-title'>{location.name}</h4>
            <Badge variant='secondary'>
              {getRelationshipLabel(location, labels)}
            </Badge>
          </div>

          {location.venueName || location.floorOrCounter ? (
            <p className='mt-1 type-card-description'>
              {[location.venueName, location.floorOrCounter]
                .filter(Boolean)
                .join(' - ')}
            </p>
          ) : null}

          <p className='mt-1 type-card-description'>{location.address}</p>
          <p
            className={
              location.availabilityNote
                ? 'mt-2 type-field-value'
                : 'mt-2 type-card-description'
            }
          >
            {location.availabilityNote ?? getDefaultNote(location, labels)}
          </p>

          <a
            href={getMapsHref(location)}
            target='_blank'
            rel='noopener noreferrer'
            className={buttonVariants({
              variant: 'secondary',
              className: 'mt-3 min-h-12',
            })}
          >
            {labels.openInMaps}
            <ExternalLink aria-hidden='true' className='size-4' />
          </a>
        </div>
      </div>
    </SurfaceCard>
  )
}

function ConfirmedLocationRows({
  locations,
  labels,
}: ConfirmedLocationExplorerProps) {
  return (
    <div className='grid gap-3 sm:grid-cols-2'>
      {locations.map((location, index) => (
        <ConfirmedLocationRow
          key={`${location.name}-${location.address}-${index}`}
          location={location}
          labels={labels}
        />
      ))}
    </div>
  )
}

export function ConfirmedLocationExplorer({
  locations,
  labels,
}: ConfirmedLocationExplorerProps) {
  const brandStoreCount = locations.filter(
    (location) => location.relationshipType === 'brand_store',
  ).length
  const otherSalesCount = locations.length - brandStoreCount
  const showFilters = brandStoreCount > 0 && otherSalesCount > 0
  const [filter, setFilter] = useState<LocationFilter>('all')
  const [view, setView] = useState<ViewMode>(() =>
    locations.some(isMappableRetailLocation) ? 'map' : 'list',
  )
  const filteredLocations = locations.filter((location) =>
    matchesFilter(location, filter),
  )
  const mappableLocations = filteredLocations.filter(isMappableRetailLocation)
  const hasMappableLocations = mappableLocations.length > 0

  function selectFilter(nextFilter: LocationFilter) {
    setFilter(nextFilter)
    const nextFilterHasMap = locations.some(
      (location) =>
        matchesFilter(location, nextFilter) &&
        isMappableRetailLocation(location),
    )
    if (!nextFilterHasMap) setView('list')
  }

  const filterOptions: Array<{
    count: number
    filter: LocationFilter
    label: string
  }> = [
    { count: locations.length, filter: 'all', label: labels.filterAll },
    {
      count: brandStoreCount,
      filter: 'brand-stores',
      label: labels.filterBrandStores,
    },
    {
      count: otherSalesCount,
      filter: 'other-sales',
      label: labels.filterOtherSales,
    },
  ]

  return (
    <div className='space-y-3'>
      {showFilters ? (
        <div className='flex flex-wrap gap-2'>
          {filterOptions.map((option) => (
            <Button
              key={option.filter}
              type='button'
              variant={filter === option.filter ? 'primary' : 'secondary'}
              className='min-h-12'
              aria-pressed={filter === option.filter}
              onClick={() => selectFilter(option.filter)}
            >
              {option.label} {option.count}
            </Button>
          ))}
        </div>
      ) : null}

      {view === 'map' && hasMappableLocations ? (
        <>
          <BrandLocationsMap
            locations={mappableLocations}
            mapTitle={labels.mapTitle}
            loadingLabel={labels.mapLoading}
          />
          <ConfirmedLocationRows
            locations={filteredLocations.slice(0, 3)}
            labels={labels}
          />
          <Button
            type='button'
            variant='secondary'
            className='min-h-12'
            onClick={() => setView('list')}
          >
            {labels.viewAll}
          </Button>
        </>
      ) : (
        <>
          <ConfirmedLocationRows locations={filteredLocations} labels={labels} />
          {hasMappableLocations ? (
            <Button
              type='button'
              variant='secondary'
              className='min-h-12'
              onClick={() => setView('map')}
            >
              {labels.mapView}
            </Button>
          ) : null}
        </>
      )}
    </div>
  )
}
