// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import en from '../../../messages/en.json'
import type { EventAreaOption, EventBrandEntry } from '@/lib/services/events'

const mocks = vi.hoisted(() => ({
  useSearchParams: vi.fn(() => new URLSearchParams()),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: mocks.useSearchParams,
}))

// The card and the grid chrome are exercised by their own suites; stubbing them
// keeps this file about the one thing it asserts — which entries survive the
// area filter — instead of dragging in image hosts and IntersectionObserver.
vi.mock('@/components/brands/brand-card', () => ({
  BrandCard: ({ brand }: { brand: { name: string } }) => (
    <div data-testid="brand-card">{brand.name}</div>
  ),
}))

vi.mock('@/components/brands/masonry-grid', () => ({
  MasonryGrid: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}))

vi.mock('@/components/analytics/view-item-list-tracker', () => ({
  ViewItemListTracker: () => null,
}))

vi.mock('@/hooks/use-saved-brands', () => ({
  SavedBrandsProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}))

import { EventBrandGrid } from './event-brand-grid'

function makeEntry(name: string, area: string): EventBrandEntry {
  return {
    brand: { id: name, slug: name, name },
    booth: null,
    area,
    areaEn: area,
    note: null,
    noteEn: null,
    sortOrder: 0,
  } as unknown as EventBrandEntry
}

function renderGrid(entries: EventBrandEntry[], areaOptions: EventAreaOption[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <EventBrandGrid
        entries={entries}
        areaOptions={areaOptions}
        eventSlug="creative-expo-2026"
        locale="en"
      />
    </NextIntlClientProvider>,
  )
}

function renderedBrandNames(): string[] {
  return screen.queryAllByTestId('brand-card').map((node) => node.textContent ?? '')
}

describe('EventBrandGrid', () => {
  beforeEach(() => {
    mocks.useSearchParams.mockReturnValue(new URLSearchParams())
  })

  it('event_brand_grid_area_group_names_brands_not_events', () => {
    // The chip row filters the EXHIBITING BRANDS of one event. There are no
    // events on this page, so an "events" label would mis-describe the control
    // to exactly the users who rely on it.
    renderGrid([makeEntry('Warmwood', 'A')], [{ value: 'A', label: 'Hall A' }])

    expect(
      screen.getByRole('group', { name: 'Filter brands by area' }),
    ).toBeInTheDocument()
  })

  it('event_brand_grid_seeds_from_a_valid_area_param', async () => {
    mocks.useSearchParams.mockReturnValue(new URLSearchParams('area=A'))
    renderGrid(
      [makeEntry('Warmwood', 'A'), makeEntry('Kiln', 'B')],
      [
        { value: 'A', label: 'Hall A' },
        { value: 'B', label: 'Hall B' },
      ],
    )

    await waitFor(() => expect(renderedBrandNames()).toEqual(['Warmwood']))
    expect(screen.getByRole('button', { name: 'Hall A' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('event_brand_grid_ignores_an_unknown_area_param', async () => {
    // Applying an area this event does not have would render an empty grid for
    // a link that looks legitimate.
    mocks.useSearchParams.mockReturnValue(new URLSearchParams('area=Z'))
    renderGrid(
      [makeEntry('Warmwood', 'A'), makeEntry('Kiln', 'B')],
      [
        { value: 'A', label: 'Hall A' },
        { value: 'B', label: 'Hall B' },
      ],
    )

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'All areas' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    )
    expect(renderedBrandNames()).toEqual(['Warmwood', 'Kiln'])
  })

  it('event_brand_grid_allowlist_is_not_delimiter_lossy', async () => {
    // Regression: the allowlist used to be a newline-joined string that the
    // effect split back apart, so an area containing a newline flattened into
    // two entries. `'展區A'` — not a real area — then passed the check and
    // rendered an empty grid, while the genuine deep link was ignored.
    const area = '展區A\n(戶外)'
    const entries = [makeEntry('Warmwood', area), makeEntry('Kiln', 'B')]
    const options: EventAreaOption[] = [
      { value: area, label: area },
      { value: 'B', label: 'Hall B' },
    ]

    mocks.useSearchParams.mockReturnValue(
      new URLSearchParams([['area', '展區A']]),
    )
    const { unmount } = renderGrid(entries, options)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'All areas' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    )
    expect(renderedBrandNames()).toEqual(['Warmwood', 'Kiln'])
    unmount()

    // The whole value, delimiter and all, is the one that filters.
    mocks.useSearchParams.mockReturnValue(new URLSearchParams([['area', area]]))
    renderGrid(entries, options)

    await waitFor(() => expect(renderedBrandNames()).toEqual(['Warmwood']))
  })
})
