// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import en from '../../../messages/en.json'
import type {
  EventAreaOption,
  EventBrandEntry,
  EventCategoryOption,
} from '@/lib/services/events'

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
  // The real value, not a stub: the grid is mocked away but the component still
  // reads this to decide which cards preload and to size the initial cap, and a
  // missing export would throw.
  MASONRY_ABOVE_FOLD: 4,
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

function makeEntry(
  name: string,
  area: string,
  category: string | null = null,
  booth: string | null = null,
): EventBrandEntry {
  return {
    brand: {
      id: name,
      slug: name,
      name,
      categorySlug: category,
      categoryLabel: category,
    },
    booth,
    area,
    areaEn: area,
    note: null,
    noteEn: null,
    sortOrder: 0,
  } as unknown as EventBrandEntry
}

function renderGrid(
  entries: EventBrandEntry[],
  areaOptions: EventAreaOption[],
  categoryOptions: EventCategoryOption[] = [],
) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <EventBrandGrid
        entries={entries}
        areaOptions={areaOptions}
        categoryOptions={categoryOptions}
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

  it('event_brand_grid_filtered_to_zero_offers_a_way_back', async () => {
    // An area with no entries used to render an empty grid under "0 brands",
    // which reads as a broken page rather than a filter result. The count line
    // must also say what it filtered FROM: "0 brands" alone claims the event
    // has no lineup, which is a different and much worse fact.
    const user = userEvent.setup()
    mocks.useSearchParams.mockReturnValue(new URLSearchParams('area=B'))
    renderGrid(
      [makeEntry('Warmwood', 'A'), makeEntry('Kiln', 'A')],
      [
        { value: 'A', label: 'Hall A' },
        { value: 'B', label: 'Hall B' },
      ],
    )

    await waitFor(() =>
      expect(
        screen.getByText('No brands from our directory in this zone'),
      ).toBeInTheDocument(),
    )
    expect(renderedBrandNames()).toEqual([])
    expect(screen.getByRole('status')).toHaveTextContent('0 of 2 brands')

    await user.click(screen.getByRole('button', { name: 'Show all brands' }))

    expect(renderedBrandNames()).toEqual(['Warmwood', 'Kiln'])
    expect(
      screen.queryByText('No brands from our directory in this zone'),
    ).not.toBeInTheDocument()
  })

  it('event_brand_grid_seeds_from_a_valid_category_param', async () => {
    // `?category=` is seeded by the same Suspense-wrapped effect as `?area=`,
    // in a second early-returning branch — a branch that silently no-ops if it
    // reads the wrong param or checks the wrong allowlist, with no render
    // difference to catch it.
    mocks.useSearchParams.mockReturnValue(new URLSearchParams('category=apparel'))
    renderGrid(
      [makeEntry('Warmwood', 'A', 'apparel'), makeEntry('Kiln', 'A', 'homeware')],
      [{ value: 'A', label: 'Hall A' }],
      [
        { value: 'apparel', label: 'Apparel' },
        { value: 'homeware', label: 'Homeware' },
      ],
    )

    await waitFor(() => expect(renderedBrandNames()).toEqual(['Warmwood']))
    expect(screen.getByRole('button', { name: 'Apparel' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('event_brand_grid_ignores_an_unknown_category_param', async () => {
    // Same reasoning as the area allowlist: applying a category this event has
    // no brands in would render an empty grid for a link that looks legitimate.
    mocks.useSearchParams.mockReturnValue(new URLSearchParams('category=ceramics'))
    renderGrid(
      [makeEntry('Warmwood', 'A', 'apparel'), makeEntry('Kiln', 'A', 'homeware')],
      [{ value: 'A', label: 'Hall A' }],
      [
        { value: 'apparel', label: 'Apparel' },
        { value: 'homeware', label: 'Homeware' },
      ],
    )

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'All categories' }),
      ).toHaveAttribute('aria-pressed', 'true'),
    )
    expect(renderedBrandNames()).toEqual(['Warmwood', 'Kiln'])
  })

  it('event_brand_grid_area_and_category_narrow_together', async () => {
    // The two chip rows are AND, not OR: a reader who picks a zone and a
    // category is asking for the intersection. An OR reading would ADD brands
    // to the view on the second press, which is the opposite of filtering.
    const user = userEvent.setup()
    renderGrid(
      [
        makeEntry('Warmwood', 'A', 'apparel'),
        makeEntry('Kiln', 'A', 'homeware'),
        makeEntry('Saltmark', 'B', 'apparel'),
        makeEntry('Lantern', 'B', 'homeware'),
      ],
      [
        { value: 'A', label: 'Hall A' },
        { value: 'B', label: 'Hall B' },
      ],
      [
        { value: 'apparel', label: 'Apparel' },
        { value: 'homeware', label: 'Homeware' },
      ],
    )

    await user.click(screen.getByRole('button', { name: 'Hall A' }))
    expect(renderedBrandNames()).toEqual(['Warmwood', 'Kiln'])

    await user.click(screen.getByRole('button', { name: 'Apparel' }))
    expect(renderedBrandNames()).toEqual(['Warmwood'])
    expect(screen.getByRole('status')).toHaveTextContent('1 of 4 brands')

    // Clearing one axis leaves the other applied — the reader only released
    // one chip.
    await user.click(screen.getByRole('button', { name: 'All areas' }))
    expect(renderedBrandNames()).toEqual(['Warmwood', 'Saltmark'])

    await user.click(screen.getByRole('button', { name: 'All categories' }))
    expect(renderedBrandNames()).toEqual([
      'Warmwood',
      'Kiln',
      'Saltmark',
      'Lantern',
    ])
    expect(screen.getByRole('status')).toHaveTextContent('4 brands')
  })

  it('event_brand_grid_booth_sort_is_reversible', async () => {
    // Two things at once, because they are the same bug: the booth order must
    // be natural (`K1-004` before `K1-011-05`, which a string sort inverts),
    // and switching back must restore the SERVER order exactly. The server
    // shuffles once per ISR regeneration for fairness, so a sort that mutated
    // the incoming array in place would destroy an order nothing can rebuild.
    const user = userEvent.setup()
    renderGrid(
      [
        makeEntry('Saltmark', 'A', null, 'S-007'),
        makeEntry('Warmwood', 'A', null, 'K1-011-05'),
        makeEntry('Lantern', 'A', null, null),
        makeEntry('Kiln', 'A', null, 'K1-004'),
      ],
      [{ value: 'A', label: 'Hall A' }],
    )

    const serverOrder = ['Saltmark', 'Warmwood', 'Lantern', 'Kiln']
    expect(renderedBrandNames()).toEqual(serverOrder)

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Sort the lineup' }),
      'booth',
    )
    // The boothless entry sorts LAST, never first: burying the walkable list
    // under entries that cannot be walked to defeats the sort.
    expect(renderedBrandNames()).toEqual([
      'Kiln',
      'Warmwood',
      'Saltmark',
      'Lantern',
    ])

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Sort the lineup' }),
      'recommended',
    )
    expect(renderedBrandNames()).toEqual(serverOrder)
  })

  it('event_brand_grid_search_matches_either_script_or_the_booth', async () => {
    // Names are stored as one bilingual string, so the same substring test has
    // to serve a reader typing Chinese and a reader typing the romanization —
    // and a reader who is only holding a booth sign.
    const user = userEvent.setup()
    renderGrid(
      [
        makeEntry('織療室 Ziliaoshi', 'A', null, 'K1-004'),
        makeEntry('這一窯 Huiaio studio', 'A', null, 'K3-019'),
      ],
      [{ value: 'A', label: 'Hall A' }],
    )

    const search = screen.getByRole('searchbox', {
      name: 'Search the lineup by brand name or booth number',
    })

    await user.type(search, 'ziliaoshi')
    expect(renderedBrandNames()).toEqual(['織療室 Ziliaoshi'])

    await user.clear(search)
    await user.type(search, '這一窯')
    expect(renderedBrandNames()).toEqual(['這一窯 Huiaio studio'])

    await user.clear(search)
    await user.type(search, 'K3-019')
    expect(renderedBrandNames()).toEqual(['這一窯 Huiaio studio'])

    // Whitespace is not a query: it must not filter everything away.
    await user.clear(search)
    await user.type(search, '   ')
    expect(renderedBrandNames()).toEqual([
      '織療室 Ziliaoshi',
      '這一窯 Huiaio studio',
    ])
  })

  it('event_brand_grid_search_composes_with_chips_and_offers_a_way_back', async () => {
    const user = userEvent.setup()
    renderGrid(
      [
        makeEntry('Warmwood', 'A', 'apparel', 'K1-004'),
        makeEntry('Saltmark', 'B', 'apparel', 'K2-010'),
      ],
      [
        { value: 'A', label: 'Hall A' },
        { value: 'B', label: 'Hall B' },
      ],
      [{ value: 'apparel', label: 'Apparel' }],
    )

    const search = screen.getByRole('searchbox', {
      name: 'Search the lineup by brand name or booth number',
    })

    await user.click(screen.getByRole('button', { name: 'Hall A' }))
    await user.type(search, 'mark')
    // AND, not OR: Saltmark matches the text but sits in the other hall.
    expect(renderedBrandNames()).toEqual([])
    expect(screen.getByRole('status')).toHaveTextContent('0 of 2 brands')

    // A text miss gets its own copy — "no brands in this zone" is the wrong
    // diagnosis when the reader mistyped a name.
    expect(
      screen.getByText('No brands match your search'),
    ).toBeInTheDocument()

    // The way back clears the query as well as the chips; clearing only the
    // chips could still leave zero results.
    await user.click(screen.getByRole('button', { name: 'Show all brands' }))
    expect(renderedBrandNames()).toEqual(['Warmwood', 'Saltmark'])
    expect(search).toHaveValue('')
  })

  it('event_brand_grid_expand_button_counts_the_filtered_set', async () => {
    // The cap and its button label both measure the FILTERED list: a button
    // offering the unfiltered 123 while the grid shows a search result is a
    // promise the press does not keep.
    const user = userEvent.setup()
    const entries = Array.from({ length: 20 }, (_, index) =>
      makeEntry(`Brand ${index}`, 'A', null, `K1-${String(index).padStart(3, '0')}`),
    )
    renderGrid(entries, [{ value: 'A', label: 'Hall A' }])

    // 20 entries against a 16-card cap (4 rows x MASONRY_ABOVE_FOLD 4).
    expect(
      screen.getByRole('button', { name: 'Show 4 more brands' }),
    ).toBeInTheDocument()

    await user.type(
      screen.getByRole('searchbox', {
        name: 'Search the lineup by brand name or booth number',
      }),
      'Brand 1',
    )

    // "Brand 1" plus "Brand 10".."Brand 19" is 11 — under the cap, so the
    // button is gone rather than naming a count from the unfiltered list.
    expect(screen.getByRole('status')).toHaveTextContent('11 of 20 brands')
    expect(
      screen.queryByRole('button', { name: /Show \d+ more brands/ }),
    ).not.toBeInTheDocument()
  })
})
