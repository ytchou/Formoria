/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { SearchInput } from './search-input'
import zh from '../../../messages/zh-TW.json'

const mockSetSearch = vi.fn()
const mockPush = vi.fn()
const mockTrackSearchExecuted = vi.fn()
const mockTrackSearchNoResults = vi.fn()
const mockTrackSearchResultClicked = vi.fn()
let mockSearch = ''
vi.mock('@/hooks/use-filter-params', () => ({
  useFilterParams: () => ({
    filters: { search: mockSearch },
    setSearch: mockSetSearch,
  }),
}))

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('@/lib/analytics', () => ({
  trackSearchExecuted: (...args: unknown[]) => mockTrackSearchExecuted(...args),
  trackSearchNoResults: (...args: unknown[]) => mockTrackSearchNoResults(...args),
  trackSearchResultClicked: (...args: unknown[]) => mockTrackSearchResultClicked(...args),
}))

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ results: [] }),
})

function renderWithProvider(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zh}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe('SearchInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearch = ''
  })

  it('renders a search input with accessible label', () => {
    renderWithProvider(<SearchInput />)

    const input = screen.getByRole('searchbox', { name: /搜尋品牌/ })
    expect(input).toBeInTheDocument()
  })

  it('calls setSearch on user input after debounce', async () => {
    const user = userEvent.setup()
    renderWithProvider(<SearchInput />)

    const input = screen.getByRole('searchbox')
    await user.type(input, 'tea')

    await waitFor(() => {
      expect(mockSetSearch).toHaveBeenLastCalledWith('tea')
    })
  })

  it('shows clear button when input has value', async () => {
    const user = userEvent.setup()
    renderWithProvider(<SearchInput />)

    const input = screen.getByRole('searchbox')
    await user.type(input, 'test')

    const clearButton = screen.getByRole('button', { name: /清除/ })
    expect(clearButton).toBeInTheDocument()
  })

  it('clears input and calls setSearch with empty string on clear', async () => {
    const user = userEvent.setup()
    renderWithProvider(<SearchInput />)

    const input = screen.getByRole('searchbox')
    await user.type(input, 'test')
    await user.click(screen.getByRole('button', { name: /清除/ }))

    expect(input).toHaveValue('')
    expect(mockSetSearch).toHaveBeenLastCalledWith('')
  })

  it('caps input at 100 characters', () => {
    renderWithProvider(<SearchInput />)

    const input = screen.getByRole('searchbox')
    expect(input).toHaveAttribute('maxLength', '100')
  })

  it('synchronizes its value when another filter control changes the URL search', () => {
    const { rerender } = renderWithProvider(<SearchInput />)
    expect(screen.getByRole('searchbox')).toHaveValue('')

    mockSearch = 'herbs'
    rerender(
      <NextIntlClientProvider locale="zh-TW" messages={zh}>
        <SearchInput />
      </NextIntlClientProvider>,
    )

    expect(screen.getByRole('searchbox')).toHaveValue('herbs')
  })

  it('accepts a distinct accessible label for the search landmark', () => {
    renderWithProvider(<SearchInput formAriaLabel="Filter brands by name" />)

    expect(
      screen.getByRole('search', { name: 'Filter brands by name' }),
    ).toBeInTheDocument()
  })

  it('does not emit a no-results event for autocomplete', async () => {
    const user = userEvent.setup()
    renderWithProvider(<SearchInput />)

    await user.type(screen.getByRole('searchbox'), 'missing')
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())

    expect(mockTrackSearchNoResults).not.toHaveBeenCalled()
  })

  it('emits search before search_no_results when a submitted query has no results', async () => {
    const user = userEvent.setup()
    renderWithProvider(<SearchInput showAutocomplete={false} />)

    await user.type(screen.getByRole('searchbox'), 'missing')
    await user.keyboard('{Enter}')

    expect(mockTrackSearchExecuted).toHaveBeenCalledWith('missing', 0)
    expect(mockTrackSearchNoResults).toHaveBeenCalledWith('missing')
    expect(mockTrackSearchExecuted.mock.invocationCallOrder[0]).toBeLessThan(
      mockTrackSearchNoResults.mock.invocationCallOrder[0],
    )
  })

  it('emits search before a selected result click', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{ id: 'brand-1', name: 'Coffee Brand', slug: 'coffee-brand', category: 'Food' }],
      }),
    } as Response)
    const user = userEvent.setup()
    renderWithProvider(<SearchInput />)

    await user.type(screen.getByRole('searchbox'), 'coffee')
    await user.click(await screen.findByRole('option', { name: /Coffee Brand/ }))

    expect(mockTrackSearchExecuted).toHaveBeenCalledWith('coffee', 1)
    expect(mockTrackSearchResultClicked).toHaveBeenCalledWith('coffee', 0)
    expect(mockTrackSearchExecuted.mock.invocationCallOrder[0]).toBeLessThan(
      mockTrackSearchResultClicked.mock.invocationCallOrder[0],
    )
  })
})

describe('SearchInput with redirectTo prop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('navigates to redirectTo path with search param on Enter', async () => {
    // window.location.href assignment is used for cross-page redirects.
    // jsdom throws "Not implemented: navigation" but we can catch and verify.
    const originalLocation = window.location
    const hrefValues: string[] = []
    delete (window as { location?: unknown }).location
    Object.defineProperty(window, 'location', {
      value: new Proxy(originalLocation, {
        set(_target, prop, value) {
          if (prop === 'href') hrefValues.push(value as string)
          return true
        },
        get(target, prop) {
          if (prop === 'href') return ''
          return Reflect.get(target, prop)
        },
      }),
      writable: true,
      configurable: true,
    })

    const user = userEvent.setup()
    renderWithProvider(<SearchInput redirectTo="/brands" />)

    const input = screen.getByRole('searchbox')
    await user.type(input, 'coffee')
    await user.keyboard('{Enter}')

    expect(hrefValues).toContain('/brands?search=coffee')

    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    })
  })

  it('does not call setSearch when redirectTo is set and Enter is pressed', async () => {
    const user = userEvent.setup()
    renderWithProvider(<SearchInput redirectTo="/brands" />)

    const input = screen.getByRole('searchbox')
    await user.type(input, 'coffee')

    // Clear calls from typing (change events)
    vi.clearAllMocks()

    await user.keyboard('{Enter}')

    expect(mockSetSearch).not.toHaveBeenCalled()
  })
})
