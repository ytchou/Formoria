// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render as rtlRender } from '@testing-library/react'
import { type ReactElement } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '@/../messages/en.json'

vi.mock('react-simple-maps', () => ({
  ComposableMap: ({ children }: { children: React.ReactNode }) => <svg data-testid="map">{children}</svg>,
  Geographies: ({ children }: { children: (props: { geographies: unknown[] }) => React.ReactNode }) =>
    <>{children({ geographies: [] })}</>,
  Geography: () => <path />,
}))

import { TaiwanMap } from '../TaiwanMap'

const render = (ui: ReactElement) =>
  rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  )

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
