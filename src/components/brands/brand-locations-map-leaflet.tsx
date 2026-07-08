'use client'

import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet'
import type { LatLngBoundsExpression, LatLngExpression } from 'leaflet'
import type { RetailLocation } from '@/lib/types'
import { hasLocationCoordinates } from '@/lib/brands/locations'

type PinnedLocation = RetailLocation & {
  latitude: number
  longitude: number
}

function getPosition(location: PinnedLocation): LatLngExpression {
  return [location.latitude, location.longitude]
}

export function BrandLocationsLeaflet({
  locations,
  mapTitle,
}: {
  locations: RetailLocation[]
  mapTitle: string
}) {
  const pinnedLocations = locations.filter(hasLocationCoordinates)
  const firstLocation = pinnedLocations.at(0)

  if (!firstLocation) return null

  const positions = pinnedLocations.map(getPosition)
  const bounds =
    positions.length > 1 ? (positions as LatLngBoundsExpression) : undefined

  return (
    <div
      aria-label={mapTitle}
      className="h-72 overflow-hidden rounded-lg border border-border bg-muted"
      role="region"
    >
      <MapContainer
        bounds={bounds}
        boundsOptions={{ padding: [24, 24] }}
        center={bounds ? undefined : getPosition(firstLocation)}
        className="h-full w-full"
        scrollWheelZoom={false}
        zoom={15}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {pinnedLocations.map((location, index) => (
          <CircleMarker
            key={`${location.name}-${location.latitude}-${location.longitude}-${index}`}
            center={getPosition(location)}
            fillColor="var(--primary)"
            fillOpacity={0.9}
            pathOptions={{
              color: 'var(--primary-foreground)',
              fillColor: 'var(--primary)',
              fillOpacity: 0.9,
              weight: 2,
            }}
            radius={9}
          >
            <Popup>
              <strong>{location.name}</strong>
              {location.address ? (
                <>
                  <br />
                  {location.address}
                </>
              ) : null}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  )
}
