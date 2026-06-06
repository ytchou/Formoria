// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/../messages/en.json'
import { LinkBreakdown } from '../link-breakdown'

const wrap = (ui: ReactNode) => (
  <NextIntlClientProvider
    locale="en"
    messages={en}
  >
    {ui}
  </NextIntlClientProvider>
)

describe('LinkBreakdown', () => {
  it('renders rows sorted desc with proportional bar widths', () => {
    render(wrap(
      <LinkBreakdown
        rows={[
          { destination: 'shopee', clicks: 42 },
          { destination: 'instagram', clicks: 24 },
          { destination: 'threads', clicks: 0 },
        ]}
      />
    ))

    const rows = screen.getAllByRole('listitem')

    expect(rows[0]).toHaveTextContent('shopee')
    expect(rows[0]).toHaveTextContent('42')
    expect(within(rows[0]).getByTestId('bar')).toHaveStyle({ width: '100%' })
  })

  it('shows the empty state when there are no clicks', () => {
    render(wrap(<LinkBreakdown rows={[]} />))

    expect(screen.getByText('No link clicks yet')).toBeInTheDocument()
  })
})
