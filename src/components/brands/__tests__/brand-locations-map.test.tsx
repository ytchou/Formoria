// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import type { ComponentType } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  BrandLocationsMap,
  type BrandMapLocation,
} from '../brand-locations-map'

type DynamicOptions = {
  loading?: ComponentType
  ssr?: boolean
}

const dynamicMock = vi.hoisted(() => ({
  options: undefined as DynamicOptions | undefined,
}))

vi.mock('next/dynamic', () => ({
  default: (
    _loader: () => Promise<unknown>,
    options: DynamicOptions,
  ) => {
    dynamicMock.options = options

    return function DynamicMock() {
      const Loading = options.loading
      return Loading ? <Loading /> : null
    }
  },
}))

const location: BrandMapLocation = {
  kind: 'location',
  name: '品牌門市',
  relationshipType: 'brand_store',
  confirmationStatus: 'owner_confirmed',
  address: '台北市品牌路 1 號',
  latitude: 25.03,
  longitude: 121.56,
}

describe('BrandLocationsMap', () => {
  it('uses ssr:false and renders the localized dynamic fallback', () => {
    render(
      <BrandLocationsMap
        locations={[location]}
        loadingLabel='正在載入地圖'
        mapTitle='品牌門市地圖'
        zoomInLabel='放大地圖'
        zoomOutLabel='縮小地圖'
      />,
    )

    expect(dynamicMock.options?.ssr).toBe(false)
    expect(screen.getByText('正在載入地圖')).toBeInTheDocument()
    expect(screen.queryByText('Loading map...')).not.toBeInTheDocument()
  })
})
