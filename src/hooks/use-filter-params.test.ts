/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPush = vi.fn()
let mockSearchParams: URLSearchParams

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/',
  useSearchParams: () => mockSearchParams,
}))

import { renderHook, act } from '@testing-library/react'
import { useFilterParams } from './use-filter-params'

beforeEach(() => {
  mockPush.mockClear()
  mockSearchParams = new URLSearchParams()
})

describe('useFilterParams', () => {
  describe('page management', () => {
    it('returns page 1 when no page param', () => {
      const { result } = renderHook(() => useFilterParams())
      expect(result.current.currentPage).toBe(1)
    })

    it('parses page from URL params', () => {
      mockSearchParams = new URLSearchParams('page=3')
      const { result } = renderHook(() => useFilterParams())
      expect(result.current.currentPage).toBe(3)
    })

    it('setPage updates URL with page param', () => {
      const { result } = renderHook(() => useFilterParams())
      act(() => result.current.setPage(2))
      expect(mockPush).toHaveBeenCalledWith(
        expect.stringContaining('page=2'),
        { scroll: false }
      )
    })
  })

  describe('sort management', () => {
    it('returns "random" when no sort param', () => {
      const { result } = renderHook(() => useFilterParams())
      expect(result.current.currentSort).toBe('random')
    })

    it('parses sort from URL params', () => {
      mockSearchParams = new URLSearchParams('sort=newest')
      const { result } = renderHook(() => useFilterParams())
      expect(result.current.currentSort).toBe('newest')
    })

    it('setSort updates URL and resets page to 1', () => {
      mockSearchParams = new URLSearchParams('sort=name&page=3')
      const { result } = renderHook(() => useFilterParams())
      act(() => result.current.setSort('newest'))
      const pushArg = mockPush.mock.calls[0][0] as string
      expect(pushArg).toContain('sort=newest')
      expect(pushArg).not.toContain('page=')
    })
  })

  describe('search', () => {
    it('reads search param from URL', () => {
      mockSearchParams = new URLSearchParams('search=tea')
      const { result } = renderHook(() => useFilterParams())

      expect(result.current.filters.search).toBe('tea')
    })

    it('setSearch updates URL with search param', () => {
      const { result } = renderHook(() => useFilterParams())

      act(() => {
        result.current.setSearch('tea')
      })

      expect(mockPush).toHaveBeenCalledWith(
        expect.stringContaining('search=tea'),
        { scroll: false }
      )
    })

    it('setSearch resets page to 1', () => {
      mockSearchParams = new URLSearchParams('page=3')
      const { result } = renderHook(() => useFilterParams())

      act(() => {
        result.current.setSearch('test')
      })

      expect(mockPush).toHaveBeenCalledWith(
        expect.not.stringContaining('page='),
        { scroll: false }
      )
    })

    it('setSearch pushes URL immediately (debounce lives in search-input)', () => {
      const { result } = renderHook(() => useFilterParams())

      act(() => {
        result.current.setSearch('tea')
      })

      expect(mockPush).toHaveBeenCalledTimes(1)
      expect(mockPush).toHaveBeenCalledWith(
        expect.stringContaining('search=tea'),
        { scroll: false }
      )
    })

    it('clearFilters removes search param', () => {
      mockSearchParams = new URLSearchParams('search=test')
      const { result } = renderHook(() => useFilterParams())

      act(() => {
        result.current.clearFilters()
      })

      expect(mockPush).toHaveBeenCalledWith(
        expect.not.stringContaining('search='),
        { scroll: false }
      )
    })
  })

  describe('filter + page interaction', () => {
    it('clearFilters resets page to 1', () => {
      mockSearchParams = new URLSearchParams('page=3')
      const { result } = renderHook(() => useFilterParams())
      act(() => result.current.clearFilters())
      const pushArg = mockPush.mock.calls[0][0] as string
      expect(pushArg).not.toContain('page=')
    })
  })
})
