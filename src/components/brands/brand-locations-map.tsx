'use client'

import dynamic from 'next/dynamic'
import { createContext, useContext } from 'react'
import type { PhysicalRetailLocation } from '@/lib/types/brand'

export type BrandMapLocation = PhysicalRetailLocation & {
  kind: 'location'
  address: string
  latitude: number
  longitude: number
  confirmationStatus: 'unconfirmed' | 'owner_confirmed'
}

const MapLoadingLabelContext = createContext('')

function BrandLocationsMapLoading() {
  const loadingLabel = useContext(MapLoadingLabelContext)

  return (
    <div className='flex h-72 items-center justify-center rounded-lg border border-border bg-muted type-card-description'>
      {loadingLabel}
    </div>
  )
}

const BrandLocationsLeaflet = dynamic(
  () =>
    import('./brand-locations-map-leaflet').then(
      (mod) => mod.BrandLocationsLeaflet,
    ),
  {
    ssr: false,
    loading: BrandLocationsMapLoading,
  },
)

export function BrandLocationsMap({
  locations,
  mapTitle,
  loadingLabel,
  zoomInLabel,
  zoomOutLabel,
}: {
  locations: BrandMapLocation[]
  mapTitle: string
  loadingLabel: string
  zoomInLabel: string
  zoomOutLabel: string
}) {
  return (
    <MapLoadingLabelContext value={loadingLabel}>
      <BrandLocationsLeaflet
        locations={locations}
        mapTitle={mapTitle}
        zoomInLabel={zoomInLabel}
        zoomOutLabel={zoomOutLabel}
      />
    </MapLoadingLabelContext>
  )
}
