import { NextRequest, NextResponse } from 'next/server'

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

export interface RateLimitStore {
  check(key: string, windowMs: number, maxRequests: number): RateLimitResult
}

export function createInMemoryRateLimiter(): RateLimitStore {
  const store = new Map<string, number[]>()

  return {
    check(key: string, windowMs: number, maxRequests: number): RateLimitResult {
      const now = Date.now()
      const windowStart = now - windowMs
      const timestamps = store.get(key) ?? []

      // Filter to only timestamps within the current window (sliding window)
      const recent = timestamps.filter((t) => t > windowStart)
      if (recent.length === 0) {
        store.delete(key)
      }

      if (recent.length >= maxRequests) {
        if (recent.length > 0) {
          store.set(key, recent)
        }
        // Reset time is when the oldest timestamp in the window expires
        const resetAt = (recent[0] ?? now) + windowMs
        return { allowed: false, remaining: 0, resetAt }
      }

      recent.push(now)
      store.set(key, recent)
      return { allowed: true, remaining: maxRequests - recent.length, resetAt: now + windowMs }
    },
  }
}

// Singleton instance shared across requests within a process
const rateLimiter = createInMemoryRateLimiter()

// Rate limit rules per path prefix
export const RATE_LIMIT_RULES: Record<string, { windowMs: number; maxRequests: number }> = {
  '/api/scrape': { windowMs: 60_000, maxRequests: 5 },
  '/api/upload': { windowMs: 60_000, maxRequests: 20 },
  '/api/': { windowMs: 60_000, maxRequests: 60 },
}

export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  return request.headers.get('x-real-ip') ?? 'unknown'
}

export function checkRateLimit(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl

  // Find the most specific matching rule
  const ruleKey = Object.keys(RATE_LIMIT_RULES)
    .filter((prefix) => pathname.startsWith(prefix))
    .sort((a, b) => b.length - a.length)[0]

  if (!ruleKey) return null

  const rule = RATE_LIMIT_RULES[ruleKey]
  const ip = getClientIp(request)
  const key = `${ruleKey}:${ip}`

  const result = rateLimiter.check(key, rule.windowMs, rule.maxRequests)

  if (!result.allowed) {
    const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000)
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(rule.maxRequests),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(result.resetAt),
        },
      }
    )
  }

  return null
}
