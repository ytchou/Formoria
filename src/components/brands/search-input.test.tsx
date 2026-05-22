/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SearchInput } from './search-input'

const mockSetSearch = vi.fn()
vi.mock('@/hooks/use-filter-params', () => ({
  useFilterParams: () => ({
    filters: { search: '' },
    setSearch: mockSetSearch,
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}))

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ results: [] }),
})

describe('SearchInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a search input with accessible label', () => {
    render(<SearchInput />)

    const input = screen.getByRole('searchbox')
    expect(input).toBeInTheDocument()
    expect(screen.getByLabelText(/搜尋/)).toBeInTheDocument()
  })

  it('calls setSearch on user input', async () => {
    const user = userEvent.setup()
    render(<SearchInput />)

    const input = screen.getByRole('searchbox')
    await user.type(input, 'tea')

    expect(mockSetSearch).toHaveBeenLastCalledWith('tea')
  })

  it('shows clear button when input has value', async () => {
    const user = userEvent.setup()
    render(<SearchInput />)

    const input = screen.getByRole('searchbox')
    await user.type(input, 'test')

    const clearButton = screen.getByRole('button', { name: /清除/ })
    expect(clearButton).toBeInTheDocument()
  })

  it('clears input and calls setSearch with empty string on clear', async () => {
    const user = userEvent.setup()
    render(<SearchInput />)

    const input = screen.getByRole('searchbox')
    await user.type(input, 'test')
    await user.click(screen.getByRole('button', { name: /清除/ }))

    expect(input).toHaveValue('')
    expect(mockSetSearch).toHaveBeenLastCalledWith('')
  })

  it('caps input at 100 characters', () => {
    render(<SearchInput />)

    const input = screen.getByRole('searchbox')
    expect(input).toHaveAttribute('maxLength', '100')
  })
})
