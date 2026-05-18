/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPush = vi.fn()
let mockSearchParams: URLSearchParams

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/brands',
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
    it('returns "name" when no sort param', () => {
      const { result } = renderHook(() => useFilterParams())
      expect(result.current.currentSort).toBe('name')
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

  describe('filter + page interaction', () => {
    it('toggleSlug resets page to 1', () => {
      mockSearchParams = new URLSearchParams('page=3&tags=food')
      const { result } = renderHook(() => useFilterParams())
      act(() => result.current.toggleSlug('textile'))
      const pushArg = mockPush.mock.calls[0][0] as string
      expect(pushArg).not.toContain('page=')
      expect(pushArg).toContain('tags=food%2Ctextile')
    })

    it('clearFilters resets page to 1', () => {
      mockSearchParams = new URLSearchParams('page=3&tags=food')
      const { result } = renderHook(() => useFilterParams())
      act(() => result.current.clearFilters())
      const pushArg = mockPush.mock.calls[0][0] as string
      expect(pushArg).not.toContain('page=')
      expect(pushArg).not.toContain('tags=')
    })
  })
})
