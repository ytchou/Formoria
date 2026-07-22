'use client'

import { useEffect } from 'react'
import { divIcon, type LatLngBoundsExpression, type LatLngExpression } from 'leaflet'
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  useMap,
} from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import type { BrandMapLocation } from './brand-locations-map'

const BOUNDS_PADDING: [number, number] = [24, 24]

function getPosition(location: BrandMapLocation): LatLngExpression {
  return [location.latitude, location.longitude]
}

function createClusterIcon(cluster: { getChildCount: () => number }) {
  return divIcon({
    className:
      'flex size-10 items-center justify-center rounded-full border-2 border-primary-foreground bg-primary text-primary-foreground type-label shadow-md',
    html: `<span>${cluster.getChildCount()}</span>`,
    iconSize: [40, 40],
  })
}

function MapBoundsController({
  locations,
}: {
  locations: BrandMapLocation[]
}) {
  const map = useMap()

  useEffect(() => {
    const positions = locations.map(getPosition)
    const firstPosition = positions.at(0)

    if (!firstPosition) return
    if (positions.length === 1) {
      map.setView(firstPosition, 15)
      return
    }

    map.fitBounds(positions as LatLngBoundsExpression, {
      padding: BOUNDS_PADDING,
    })
  }, [locations, map])

  return null
}

export function BrandLocationsLeaflet({
  locations,
  mapTitle,
}: {
  locations: BrandMapLocation[]
  mapTitle: string
}) {
  const firstLocation = locations.at(0)

  if (!firstLocation) return null

  return (
    <div
      aria-label={mapTitle}
      className='h-72 overflow-hidden rounded-lg border border-border bg-muted'
      role='region'
    >
      <MapContainer
        center={getPosition(firstLocation)}
        className='h-full w-full'
        scrollWheelZoom={false}
        zoom={15}
      >
        <MapBoundsController locations={locations} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url='https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
        />
        <MarkerClusterGroup iconCreateFunction={createClusterIcon}>
          {locations.map((location, index) => (
            <CircleMarker
              key={`${location.name}-${location.latitude}-${location.longitude}-${index}`}
              center={getPosition(location)}
              fillColor='var(--primary)'
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
                <br />
                {location.address}
              </Popup>
            </CircleMarker>
          ))}
        </MarkerClusterGroup>
      </MapContainer>
    </div>
  )
}
