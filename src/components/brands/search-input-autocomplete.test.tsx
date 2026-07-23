/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import en from '../../../messages/en.json'
import zhTW from '../../../messages/zh-TW.json'

// Mock useFilterParams
const mockSetSearch = vi.fn()
vi.mock('@/hooks/use-filter-params', () => ({
  useFilterParams: () => ({
    filters: { search: '' },
    setSearch: mockSetSearch,
  }),
}))

// Mock navigation
const mockPush = vi.fn()
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

// Mock fetch for autocomplete API
const mockFetch = vi.fn()
global.fetch = mockFetch

const { default: SearchInput } = await import('./search-input')

function renderWithProvider(
  ui: React.ReactElement,
  locale = 'en',
  messages = en,
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {ui}
    </NextIntlClientProvider>
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function searchResponse(name: string, id = name.toLowerCase().replaceAll(' ', '-')) {
  return {
    ok: true,
    json: () => Promise.resolve({
      results: [{
        id,
        name,
        slug: id,
        category: 'Food & Beverage',
      }],
    }),
  }
}

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
              category: 'Food & Beverage',
              similarity: 0.9,
            },
            {
              id: '2',
              name: 'Tea Garden',
              slug: 'tea-garden',
              category: 'Food & Beverage',
              similarity: 0.7,
            },
          ],
        }),
    })
  })

  it('shows suggestions dropdown after typing', async () => {
    const user = userEvent.setup()
    renderWithProvider(<SearchInput />)

    const input = screen.getByRole('searchbox')
    await user.type(input, 'tea')

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument()
    })

    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('Tea House')
    expect(options[1]).toHaveTextContent('Tea Garden')
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith('/api/search?q=tea&limit=5', {
      signal: expect.any(AbortSignal),
    })
  })

  it('localizes suggestion categories for the Traditional Chinese locale', async () => {
    const user = userEvent.setup()
    renderWithProvider(<SearchInput />, 'zh-TW', zhTW)

    await user.type(screen.getByRole('searchbox'), 'tea')

    const option = await screen.findByRole('option', { name: /Tea House/ })
    expect(option).toHaveTextContent('食品飲料')
    expect(option).not.toHaveTextContent('Food & Beverage')
  })

  it('navigates suggestions with arrow keys', async () => {
    const user = userEvent.setup()
    renderWithProvider(<SearchInput />)

    const input = screen.getByRole('searchbox')
    await user.type(input, 'tea')

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument()
    })

    await user.keyboard('{ArrowDown}')
    const firstOption = screen.getAllByRole('option')[0]
    expect(firstOption).toHaveAttribute('aria-selected', 'true')
    expect(input).toHaveAttribute('aria-activedescendant', 'search-suggestion-1')

    await user.keyboard('{ArrowDown}')
    const secondOption = screen.getAllByRole('option')[1]
    expect(secondOption).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowDown}')
    expect(secondOption).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}')
    expect(input).not.toHaveAttribute('aria-activedescendant')
  })

  it('selects the active suggestion on Enter', async () => {
    const user = userEvent.setup()
    renderWithProvider(<SearchInput />)

    await user.type(screen.getByRole('searchbox'), 'tea')
    await screen.findByRole('listbox')
    await user.keyboard('{ArrowDown}{Enter}')

    expect(mockPush).toHaveBeenCalledWith('/brands/tea-house')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes dropdown on Escape', async () => {
    const user = userEvent.setup()
    renderWithProvider(<SearchInput />)

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
    renderWithProvider(<SearchInput />)

    const input = screen.getByRole('searchbox')
    await user.type(input, 'xyznonexistent')

    await waitFor(() => {
      expect(screen.getByText(/no results/i)).toBeInTheDocument()
    })
  })

  it('does not request autocomplete when suggestions are disabled', async () => {
    const user = userEvent.setup()
    renderWithProvider(<SearchInput showAutocomplete={false} />)

    await user.type(screen.getByRole('searchbox'), 'tea')

    await waitFor(() => {
      expect(mockFetch).not.toHaveBeenCalled()
    })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('ignores an older response that resolves after the latest query', async () => {
    const first = deferred<ReturnType<typeof searchResponse>>()
    const second = deferred<ReturnType<typeof searchResponse>>()
    mockFetch
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const user = userEvent.setup()
    renderWithProvider(<SearchInput />)
    const input = screen.getByRole('searchbox')

    await user.type(input, 'tea')
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    await user.clear(input)
    await user.type(input, 'teapot')
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))

    second.resolve(searchResponse('Latest Teapot'))
    await expect(screen.findByRole('option', { name: /Latest Teapot/ })).resolves.toBeVisible()
    first.resolve(searchResponse('Stale Tea'))

    await waitFor(() => {
      expect(screen.queryByRole('option', { name: /Stale Tea/ })).not.toBeInTheDocument()
      expect(screen.getByRole('option', { name: /Latest Teapot/ })).toBeInTheDocument()
    })
  })

  it('does not reopen suggestions when the input is cleared in flight', async () => {
    const pending = deferred<ReturnType<typeof searchResponse>>()
    mockFetch.mockReturnValueOnce(pending.promise)
    const user = userEvent.setup()
    renderWithProvider(<SearchInput />)
    const input = screen.getByRole('searchbox')

    await user.type(input, 'tea')
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: /clear/i }))
    await act(async () => pending.resolve(searchResponse('Late Tea')))

    expect(input).toHaveValue('')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('clears prior suggestions when the latest request fails', async () => {
    const user = userEvent.setup()
    mockFetch.mockResolvedValueOnce(searchResponse('Prior Tea'))
    renderWithProvider(<SearchInput />)
    const input = screen.getByRole('searchbox')

    await user.type(input, 'tea')
    await screen.findByRole('option', { name: /Prior Tea/ })

    mockFetch.mockRejectedValueOnce(new Error('network down'))
    await user.clear(input)
    await user.type(input, 'coffee')

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
  })

  it('aborts the previous request when a new fetch starts', async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort')
    const user = userEvent.setup()
    renderWithProvider(<SearchInput />)
    const input = screen.getByRole('searchbox')

    await user.type(input, 'ab')
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    await user.type(input, 'c')
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))

    expect(abortSpy).toHaveBeenCalled()
    abortSpy.mockRestore()
  })

  it('aborts in-flight request on clear', async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort')
    const user = userEvent.setup()
    renderWithProvider(<SearchInput />)

    await user.type(screen.getByRole('searchbox'), 'tea')
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: /clear/i }))

    expect(abortSpy).toHaveBeenCalled()
    abortSpy.mockRestore()
  })

  it('does not surface AbortError as an error state', async () => {
    mockFetch.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'))
    const user = userEvent.setup()
    renderWithProvider(<SearchInput />)

    await user.type(screen.getByRole('searchbox'), 'tea')
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
