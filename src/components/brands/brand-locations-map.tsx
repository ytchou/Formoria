'use client'

import dynamic from 'next/dynamic'
import type { RetailLocation } from '@/lib/types'

const BrandLocationsLeaflet = dynamic(
  () =>
    import('./brand-locations-map-leaflet').then(
      (mod) => mod.BrandLocationsLeaflet,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-72 items-center justify-center rounded-lg border border-border bg-muted text-sm text-muted-foreground">
        Loading map...
      </div>
    ),
  },
)

export function BrandLocationsMap({
  locations,
  mapTitle,
}: {
  locations: RetailLocation[]
  mapTitle: string
}) {
  return <BrandLocationsLeaflet locations={locations} mapTitle={mapTitle} />
}
