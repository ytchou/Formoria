'use client'

import { ComposableMap, Geographies, Geography } from 'react-simple-maps'
import { TAIWAN_CITIES } from '@/lib/constants/taiwan-cities'

interface Props {
  data: { city: string; count: number }[]
}

const PROPERTY_KEY = 'name'

const TOPO_NAME_TO_SLUG: Record<string, string> = Object.fromEntries([
  ...TAIWAN_CITIES.flatMap(({ slug, nameEn }) => [[nameEn, slug]]),
  // GeoJSON quirks: Taoyuan was upgraded from County→City in 2014; Taitung has trailing newline
  ['Taoyuan County', 'taoyuan'],
  ['Taitung County', 'taitung'],
])

export function TaiwanMap({ data }: Props) {
  const maxCount = Math.max(...data.map((item) => item.count), 1)
  const countBySlug = new Map(data.map((item) => [item.city, item.count]))

  return (
    <div className="mx-auto w-full max-w-md" role="img" aria-label="Taiwan brand distribution map">
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ center: [121, 24], scale: 4000 }}
        style={{ width: '100%', height: 'auto' }}
      >
        <Geographies geography="/data/taiwan-counties.json">
          {({ geographies }) =>
            geographies.map((geo) => {
              const propVal = geo.properties[PROPERTY_KEY]
              const slug = typeof propVal === 'string' ? TOPO_NAME_TO_SLUG[propVal.trim()] : undefined
              const count = slug ? (countBySlug.get(slug) ?? 0) : 0
              const fillColor =
                count === 0
                  ? 'rgba(47, 93, 80, 0.08)'
                  : count / maxCount <= 0.33
                    ? 'rgba(47, 93, 80, 0.25)'
                    : count / maxCount <= 0.66
                      ? 'rgba(47, 93, 80, 0.55)'
                      : 'rgba(47, 93, 80, 0.85)'

              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  style={{
                    default: {
                      fill: fillColor,
                      stroke: 'var(--border)',
                      strokeWidth: 0.5,
                      outline: 'none',
                    },
                    hover: {
                      fill: fillColor,
                      stroke: 'var(--border)',
                      strokeWidth: 0.5,
                      outline: 'none',
                    },
                    pressed: { outline: 'none' },
                  }}
                  tabIndex={-1}
                  aria-hidden="true"
                />
              )
            })
          }
        </Geographies>
      </ComposableMap>
    </div>
  )
}
