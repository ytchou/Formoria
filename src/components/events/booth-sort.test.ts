import { describe, expect, it } from 'vitest'

import { compareBoothNumbers } from './booth-sort'

describe('compareBoothNumbers', () => {
  it('booth_sort_orders_numeric_runs_as_numbers', () => {
    // The whole point of the feature: lexicographically `K1-011-05` and `K1-10`
    // both sort before `K1-004`, which is the ordering a visitor reads as
    // broken.
    const sorted = ['K1-011-05', 'K1-10', 'K1-004'].sort(compareBoothNumbers)

    expect(sorted).toEqual(['K1-004', 'K1-10', 'K1-011-05'])
  })

  it('booth_sort_orders_a_parent_booth_before_its_sub_booths', () => {
    const sorted = ['K1-011-05', 'K1-011', 'K1-011-01'].sort(compareBoothNumbers)

    expect(sorted).toEqual(['K1-011', 'K1-011-01', 'K1-011-05'])
  })

  it('booth_sort_orders_zones_alphabetically_before_their_numbers', () => {
    // `S-007` has the lower number but belongs to a later zone; the zone letter
    // is the outer key because that is the order the halls are walked in.
    const sorted = ['S-007', 'K2-010', 'K1-004'].sort(compareBoothNumbers)

    expect(sorted).toEqual(['K1-004', 'K2-010', 'S-007'])
  })

  it('booth_sort_puts_missing_booths_last_without_crashing', () => {
    const sorted = ['S-024', null, 'K1-004', '', '   ', undefined].sort(
      compareBoothNumbers,
    )

    expect(sorted.slice(0, 2)).toEqual(['K1-004', 'S-024'])
    expect(sorted.slice(2)).toHaveLength(4)
    expect(compareBoothNumbers(null, undefined)).toBe(0)
    expect(compareBoothNumbers(null, 'K1-004')).toBeGreaterThan(0)
    expect(compareBoothNumbers('K1-004', '')).toBeLessThan(0)
  })

  it('booth_sort_ignores_case_and_zero_padding', () => {
    expect(compareBoothNumbers('k1-004', 'K1-004')).toBe(0)
    expect(compareBoothNumbers('K1-04', 'K1-4')).toBe(0)
  })
})
