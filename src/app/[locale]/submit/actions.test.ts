import { describe, test, expect, vi } from 'vitest'
import { checkDuplicates } from './actions'

vi.mock('@/lib/services/submissions', () => ({
  checkBrandDuplicates: vi.fn(),
  createSubmission: vi.fn(),
}))
vi.mock('@/lib/services/brands', () => ({
  createBrand: vi.fn(),
  getBrandBySlug: vi.fn(),
}))

import { checkBrandDuplicates } from '@/lib/services/submissions'

describe('checkDuplicates action', () => {
  test('returns dedup result from service', async () => {
    const mockResult = {
      ubnMatch: { id: 'b1', name: '品牌', slug: 'brand' },
      nameMatches: [],
    }
    vi.mocked(checkBrandDuplicates).mockResolvedValue(mockResult)

    const result = await checkDuplicates('品牌', '12345678')
    expect(result).toEqual(mockResult)
    expect(checkBrandDuplicates).toHaveBeenCalledWith('品牌', '12345678')
  })

  test('passes undefined UBN when not provided', async () => {
    vi.mocked(checkBrandDuplicates).mockResolvedValue({ ubnMatch: null, nameMatches: [] })

    await checkDuplicates('Some Brand')
    expect(checkBrandDuplicates).toHaveBeenCalledWith('Some Brand', undefined)
  })
})
