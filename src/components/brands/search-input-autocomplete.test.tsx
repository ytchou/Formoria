/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock useFilterParams
vi.mock('@/hooks/use-filter-params', () => ({
  useFilterParams: () => ({
    filters: { search: '' },
    setSearch: vi.fn(),
  }),
}))

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}))

// Mock fetch for autocomplete API
const mockFetch = vi.fn()
global.fetch = mockFetch

const { default: SearchInput } = await import('./search-input')

describe('SearchInput autocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [
            {
              id: '1',
              name: 'Tea House',
              slug: 'tea-house',
              logoUrl: null,
              category: 'Food & Beverage',
              similarity: 0.9,
            },
            {
              id: '2',
              name: 'Tea Garden',
              slug: 'tea-garden',
              logoUrl: null,
              category: 'Food & Beverage',
              similarity: 0.7,
            },
          ],
        }),
    })
  })

  it('shows suggestions dropdown after typing', async () => {
    const user = userEvent.setup()
    render(<SearchInput />)

    const input = screen.getByRole('searchbox')
    await user.type(input, 'tea')

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument()
    })

    expect(screen.getByText('Tea House')).toBeInTheDocument()
    expect(screen.getByText('Tea Garden')).toBeInTheDocument()
  })

  it('navigates suggestions with arrow keys', async () => {
    const user = userEvent.setup()
    render(<SearchInput />)

    const input = screen.getByRole('searchbox')
    await user.type(input, 'tea')

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument()
    })

    await user.keyboard('{ArrowDown}')
    const firstOption = screen.getAllByRole('option')[0]
    expect(firstOption).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowDown}')
    const secondOption = screen.getAllByRole('option')[1]
    expect(secondOption).toHaveAttribute('aria-selected', 'true')
  })

  it('closes dropdown on Escape', async () => {
    const user = userEvent.setup()
    render(<SearchInput />)

    const input = screen.getByRole('searchbox')
    await user.type(input, 'tea')

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument()
    })

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('shows "no results" when search returns empty', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ results: [] }),
    })

    const user = userEvent.setup()
    render(<SearchInput />)

    const input = screen.getByRole('searchbox')
    await user.type(input, 'xyznonexistent')

    await waitFor(() => {
      expect(screen.getByText(/no results/i)).toBeInTheDocument()
    })
  })
})
