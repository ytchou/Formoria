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
import { Button } from '@/components/ui/button'
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

function MapZoomControls({
  zoomInLabel,
  zoomOutLabel,
}: {
  zoomInLabel: string
  zoomOutLabel: string
}) {
  const map = useMap()

  return (
    <div className='absolute right-3 top-3 z-[1000] flex flex-col gap-2'>
      <Button
        type='button'
        variant='secondary'
        size='icon'
        className='min-h-12 min-w-12 bg-card/95 text-lg'
        aria-label={zoomInLabel}
        onClick={() => map.zoomIn()}
      >
        <span aria-hidden='true'>+</span>
      </Button>
      <Button
        type='button'
        variant='secondary'
        size='icon'
        className='min-h-12 min-w-12 bg-card/95 text-lg'
        aria-label={zoomOutLabel}
        onClick={() => map.zoomOut()}
      >
        <span aria-hidden='true'>−</span>
      </Button>
    </div>
  )
}

export function BrandLocationsLeaflet({
  locations,
  mapTitle,
  zoomInLabel,
  zoomOutLabel,
}: {
  locations: BrandMapLocation[]
  mapTitle: string
  zoomInLabel: string
  zoomOutLabel: string
}) {
  const firstLocation = locations.at(0)

  if (!firstLocation) return null

  return (
    <div
      aria-label={mapTitle}
      className='relative h-72 overflow-hidden rounded-lg border border-border bg-muted'
      role='region'
    >
      <MapContainer
        center={getPosition(firstLocation)}
        className='h-full w-full'
        scrollWheelZoom={false}
        zoomControl={false}
        zoom={15}
      >
        <MapZoomControls
          zoomInLabel={zoomInLabel}
          zoomOutLabel={zoomOutLabel}
        />
        <MapBoundsController locations={locations} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          className='grayscale'
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
