import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createInMemoryRateLimiter, type RateLimitStore } from '../rate-limiter'

describe('InMemoryRateLimiter', () => {
  let limiter: RateLimitStore

  beforeEach(() => {
    vi.useFakeTimers()
    limiter = createInMemoryRateLimiter()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows requests within the limit', () => {
    const result = limiter.check('user-1', 60_000, 5)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(4)
  })

  it('blocks requests after exceeding the limit', () => {
    for (let i = 0; i < 5; i++) {
      limiter.check('user-1', 60_000, 5)
    }
    const result = limiter.check('user-1', 60_000, 5)
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
    expect(result.resetAt).toBeGreaterThan(Date.now())
  })

  it('allows requests after window expires', () => {
    for (let i = 0; i < 5; i++) {
      limiter.check('user-1', 60_000, 5)
    }
    vi.advanceTimersByTime(61_000)
    const result = limiter.check('user-1', 60_000, 5)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(4)
  })

  it('tracks different keys independently', () => {
    for (let i = 0; i < 5; i++) {
      limiter.check('user-1', 60_000, 5)
    }
    const result = limiter.check('user-2', 60_000, 5)
    expect(result.allowed).toBe(true)
  })

  it('applies sliding window correctly', () => {
    limiter.check('user-1', 60_000, 3)
    vi.advanceTimersByTime(20_000)
    limiter.check('user-1', 60_000, 3)
    vi.advanceTimersByTime(20_000)
    limiter.check('user-1', 60_000, 3)
    // 3 requests in 40s window — at limit
    const blocked = limiter.check('user-1', 60_000, 3)
    expect(blocked.allowed).toBe(false)
    // Advance past first request's window
    vi.advanceTimersByTime(21_000)
    const allowed = limiter.check('user-1', 60_000, 3)
    expect(allowed.allowed).toBe(true)
  })
})
