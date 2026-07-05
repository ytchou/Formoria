// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('react-simple-maps', () => ({
  ComposableMap: ({ children }: { children: React.ReactNode }) => <svg data-testid="map">{children}</svg>,
  Geographies: ({ children }: { children: (props: { geographies: unknown[] }) => React.ReactNode }) =>
    <>{children({ geographies: [] })}</>,
  Geography: () => <path />,
}))

import { TaiwanMap } from '../TaiwanMap'

describe('TaiwanMap', () => {
  it('renders an svg container with empty data', () => {
    const { getByTestId } = render(<TaiwanMap data={[]} />)
    expect(getByTestId('map')).toBeTruthy()
  })

  it('renders without crashing with city data', () => {
    const data = [{ city: 'taipei', count: 15 }, { city: 'tainan', count: 5 }]
    const { getByTestId } = render(<TaiwanMap data={data} />)
    expect(getByTestId('map')).toBeTruthy()
  })
})
