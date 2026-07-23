import { describe, expect, it } from 'vitest'
import { countDelta, percent, rateDelta } from './delta-formatters'

describe('analytics delta formatters', () => {
  it('countDelta returns up/down/flat with formatted text', () => {
    expect(countDelta(125, 100)).toEqual({ direction: 'up', text: '↑ 25%' })
    expect(countDelta(75, 100)).toEqual({ direction: 'down', text: '↓ 25%' })
    expect(countDelta(100, 100)).toEqual({ direction: 'flat', text: '— 0%' })
  })

  it('countDelta returns undefined for null/zero prior', () => {
    expect(countDelta(100, null)).toBeUndefined()
    expect(countDelta(100, 0)).toBeUndefined()
  })

  it('rateDelta returns percentage point delta', () => {
    expect(rateDelta(0.4, 0.25)).toEqual({
      direction: 'up',
      text: '↑ 15.0pp',
    })
    expect(rateDelta(0.15, 0.25)).toEqual({
      direction: 'down',
      text: '↓ 10.0pp',
    })
    expect(rateDelta(0.25, 0.25)).toEqual({
      direction: 'flat',
      text: '— 0.0pp',
    })
  })

  it('rateDelta returns undefined for null inputs', () => {
    expect(rateDelta(null, 0.25)).toBeUndefined()
    expect(rateDelta(0.25, null)).toBeUndefined()
  })

  it('percent formats nullable numbers', () => {
    expect(percent(null)).toBe('—')
    expect(percent(0.5)).toBe('50.0%')
    expect(percent(0)).toBe('0.0%')
  })
})
