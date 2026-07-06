import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLimit = vi.fn()
const mockNot = vi.fn(() => ({ limit: mockLimit }))
const mockEq = vi.fn(() => ({ not: mockNot }))
const mockSelect = vi.fn(() => ({ eq: mockEq }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { getApprovedProductTagSuggestions } from './product-tag-suggestions'

describe('getApprovedProductTagSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns normalized, case-insensitively deduplicated approved-brand tags', async () => {
    mockLimit.mockResolvedValue({
      data: [
        { product_tags: [' 陶瓷馬克杯 ', 'Leather Totes'] },
        { product_tags: ['leather totes', '', '亞麻圍裙'] },
        { product_tags: null },
      ],
      error: null,
    })

    await expect(getApprovedProductTagSuggestions()).resolves.toEqual([
      'Leather Totes',
      '亞麻圍裙',
      '陶瓷馬克杯',
    ])
    expect(mockFrom).toHaveBeenCalledWith('brands')
    expect(mockSelect).toHaveBeenCalledWith('product_tags')
    expect(mockEq).toHaveBeenCalledWith('status', 'approved')
  })

  it('caps the returned suggestion count', async () => {
    mockLimit.mockResolvedValue({
      data: [{ product_tags: ['A', 'B', 'C'] }],
      error: null,
    })

    await expect(getApprovedProductTagSuggestions(2)).resolves.toEqual(['A', 'B'])
  })
})
