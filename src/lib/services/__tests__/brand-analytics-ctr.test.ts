import { describe, it, expect } from 'vitest'
import { computeCtr, computeCtrTrend } from '../brand-analytics'

describe('computeCtr', () => {
  it('returns clicks / views as decimal', () => {
    expect(computeCtr(10, 200)).toBeCloseTo(0.05)
  })
  it('returns 0 when views is 0', () => {
    expect(computeCtr(5, 0)).toBe(0)
  })
})

describe('computeCtrTrend', () => {
  it('returns up when current CTR > prior CTR by more than 5%', () => {
    expect(computeCtrTrend(0.06, 0.03)).toBe('up')
  })
  it('returns down when current CTR < prior CTR by more than 5%', () => {
    expect(computeCtrTrend(0.02, 0.06)).toBe('down')
  })
  it('returns flat when CTRs are within 5%', () => {
    expect(computeCtrTrend(0.05, 0.05)).toBe('flat')
  })
})
