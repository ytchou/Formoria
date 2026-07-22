// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrandLocationsLeaflet } from '../brand-locations-map-leaflet'
import type { BrandMapLocation } from '../brand-locations-map'

type ClusterIconFactory = (cluster: {
  getChildCount: () => number
}) => unknown

const leafletMocks = vi.hoisted(() => ({
  divIcon: vi.fn((options: unknown) => options),
  fitBounds: vi.fn(),
  iconCreateFunction: undefined as ClusterIconFactory | undefined,
  setView: vi.fn(),
}))

vi.mock('leaflet', () => ({
  divIcon: leafletMocks.divIcon,
}))

vi.mock('react-leaflet', () => ({
  CircleMarker: ({
    center,
    children,
    fillColor,
    pathOptions,
  }: {
    center: unknown
    children: ReactNode
    fillColor: string
    pathOptions: unknown
  }) => (
    <div
      data-testid='circle-marker'
      data-center={JSON.stringify(center)}
      data-fill-color={fillColor}
      data-path-options={JSON.stringify(pathOptions)}
    >
      {children}
    </div>
  ),
  MapContainer: ({
    children,
    scrollWheelZoom,
  }: {
    children: ReactNode
    scrollWheelZoom: boolean
  }) => (
    <div
      data-testid='map-container'
      data-scroll-wheel-zoom={String(scrollWheelZoom)}
    >
      {children}
    </div>
  ),
  Popup: ({ children }: { children: ReactNode }) => (
    <div data-testid='popup'>{children}</div>
  ),
  TileLayer: () => null,
  useMap: () => ({
    fitBounds: leafletMocks.fitBounds,
    setView: leafletMocks.setView,
  }),
}))

vi.mock('react-leaflet-cluster', () => ({
  default: ({
    children,
    iconCreateFunction,
  }: {
    children: ReactNode
    iconCreateFunction: ClusterIconFactory
  }) => {
    leafletMocks.iconCreateFunction = iconCreateFunction
    return <div data-testid='marker-cluster'>{children}</div>
  },
}))

const firstLocation: BrandMapLocation = {
  kind: 'location',
  name: '品牌門市',
  relationshipType: 'brand_store',
  confirmationStatus: 'owner_confirmed',
  address: '台北市品牌路 1 號',
  venueName: '品牌生活館',
  floorOrCounter: '1F',
  availabilityNote: '現場展示全系列',
  latitude: 25.03,
  longitude: 121.56,
}

const secondLocation: BrandMapLocation = {
  kind: 'location',
  name: '選物店',
  relationshipType: 'stockist',
  confirmationStatus: 'owner_confirmed',
  address: '台中市選物路 2 號',
  latitude: 24.14,
  longitude: 120.68,
}

beforeEach(() => {
  leafletMocks.divIcon.mockClear()
  leafletMocks.fitBounds.mockReset()
  leafletMocks.iconCreateFunction = undefined
  leafletMocks.setView.mockReset()
})

describe('BrandLocationsLeaflet', () => {
  it('clusters semantic markers and limits popups to name and address', () => {
    render(
      <BrandLocationsLeaflet
        locations={[firstLocation, secondLocation]}
        mapTitle='品牌門市地圖'
      />,
    )

    const region = screen.getByRole('region', { name: '品牌門市地圖' })
    expect(region).toBeInTheDocument()
    expect(screen.getByTestId('map-container')).toHaveAttribute(
      'data-scroll-wheel-zoom',
      'false',
    )

    const cluster = screen.getByTestId('marker-cluster')
    const markers = within(cluster).getAllByTestId('circle-marker')
    expect(markers).toHaveLength(2)
    const firstMarker = markers.at(0)
    if (!firstMarker) throw new Error('Expected the first map marker')
    expect(firstMarker).toHaveAttribute('data-fill-color', 'var(--primary)')
    expect(firstMarker).toHaveAttribute(
      'data-path-options',
      JSON.stringify({
        color: 'var(--primary-foreground)',
        fillColor: 'var(--primary)',
        fillOpacity: 0.9,
        weight: 2,
      }),
    )

    const popups = within(cluster).getAllByTestId('popup')
    const firstPopup = popups.at(0)
    const secondPopup = popups.at(1)
    if (!firstPopup || !secondPopup) throw new Error('Expected both map popups')
    expect(within(firstPopup).getByText('品牌門市')).toBeInTheDocument()
    expect(within(firstPopup).getByText('台北市品牌路 1 號')).toBeInTheDocument()
    expect(within(secondPopup).getByText('選物店')).toBeInTheDocument()
    expect(within(secondPopup).getByText('台中市選物路 2 號')).toBeInTheDocument()
    expect(screen.queryByText('品牌生活館')).not.toBeInTheDocument()
    expect(screen.queryByText('1F')).not.toBeInTheDocument()
    expect(screen.queryByText('現場展示全系列')).not.toBeInTheDocument()

    const clusterIcon = leafletMocks.iconCreateFunction?.({
      getChildCount: () => 2,
    })
    expect(clusterIcon).toEqual(
      expect.objectContaining({
        className: expect.stringContaining('bg-primary'),
        html: '<span>2</span>',
        iconSize: [40, 40],
      }),
    )
    expect(leafletMocks.divIcon).toHaveBeenCalledWith(
      expect.objectContaining({
        className: expect.stringContaining('text-primary-foreground'),
      }),
    )
  })

  it('refits the map when filtered locations change', () => {
    const { rerender } = render(
      <BrandLocationsLeaflet
        locations={[firstLocation]}
        mapTitle='品牌門市地圖'
      />,
    )

    expect(leafletMocks.setView).toHaveBeenCalledWith([25.03, 121.56], 15)
    expect(leafletMocks.fitBounds).not.toHaveBeenCalled()

    rerender(
      <BrandLocationsLeaflet
        locations={[firstLocation, secondLocation]}
        mapTitle='品牌門市地圖'
      />,
    )

    expect(leafletMocks.fitBounds).toHaveBeenLastCalledWith(
      [
        [25.03, 121.56],
        [24.14, 120.68],
      ],
      { padding: [24, 24] },
    )
  })
})
