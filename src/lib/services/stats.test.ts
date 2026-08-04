import { describe, expect, it } from 'vitest'
import { formatSharePercentage } from './stats'

describe('formatSharePercentage', () => {
  it('never floors a non-zero share to 0%', () => {
    // The production case: 3 of 697 brands are MIT-verified.
    expect(formatSharePercentage(3, 697)).toBe(0.4)
  })

  it('keeps whole numbers for shares of 1% and above', () => {
    expect(formatSharePercentage(1, 100)).toBe(1)
    expect(formatSharePercentage(349, 697)).toBe(50)
    expect(formatSharePercentage(697, 697)).toBe(100)
  })

  it('returns 0 only when nothing is verified', () => {
    expect(formatSharePercentage(0, 697)).toBe(0)
  })

  it('does not divide by zero on an empty directory', () => {
    expect(formatSharePercentage(0, 0)).toBe(0)
    expect(formatSharePercentage(3, 0)).toBe(0)
  })

  it('floors vanishingly small shares at 0.1 rather than 0', () => {
    expect(formatSharePercentage(1, 100000)).toBe(0.1)
  })
})
