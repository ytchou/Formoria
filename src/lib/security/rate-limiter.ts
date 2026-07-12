import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { NextRequest, NextResponse } from 'next/server'

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

export interface RateLimitStore {
  check(key: string, windowMs: number, maxRequests: number): RateLimitResult
}

export interface RateLimitOptions {
  windowMs: number
  maxRequests: number
  prefix?: string
}

interface AsyncRateLimitStore {
  check(key: string, windowMs: number, maxRequests: number): Promise<RateLimitResult>
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

type UpstashLimiter = {
  limit: (identifier: string) => Promise<{
    success: boolean
    remaining: number
    reset: number
  }>
}

function createUpstashRateLimiter(): AsyncRateLimitStore {
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  })
  const limiters = new Map<string, UpstashLimiter>()

  return {
    check(key: string, windowMs: number, maxRequests: number): Promise<RateLimitResult> {
      const limiterKey = `${windowMs}:${maxRequests}`
      let limiter = limiters.get(limiterKey)

      if (!limiter) {
        limiter = new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(maxRequests, `${windowMs} ms`),
          prefix: 'fm_rl',
        })
        limiters.set(limiterKey, limiter)
      }

      return limiter.limit(key).then((result) => ({
        allowed: result.success,
        remaining: result.remaining,
        resetAt: result.reset,
      }))
    },
  }
}

function createRateLimiter(): AsyncRateLimitStore {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return createUpstashRateLimiter()
  }

  console.warn('Upstash Redis env vars missing; falling back to in-memory rate limiter')
  const inMemoryRateLimiter = createInMemoryRateLimiter()
  return {
    check(key: string, windowMs: number, maxRequests: number): Promise<RateLimitResult> {
      return Promise.resolve(inMemoryRateLimiter.check(key, windowMs, maxRequests))
    },
  }
}

const rateLimiter = createRateLimiter()

export async function rateLimit(
  identifier: string,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const key = options.prefix ? `${options.prefix}:${identifier}` : identifier
  return rateLimiter.check(key, options.windowMs, options.maxRequests)
}

// Rate limit rules per path prefix
const RATE_LIMIT_RULES: Record<string, { windowMs: number; maxRequests: number }> = {
  '/admin/operations': { windowMs: 60_000, maxRequests: 3 },
  '/api/upload': { windowMs: 60_000, maxRequests: 20 },
  '/api/webhooks/tally': { windowMs: 60_000, maxRequests: 30 },
  '/api/': { windowMs: 60_000, maxRequests: 60 },
  '/brands/': { windowMs: 60_000, maxRequests: 40 },
  '/sitemap.xml': { windowMs: 60_000, maxRequests: 3 },
}

const KNOWN_LOCALES = ['en', 'zh-TW']

const CRAWLER_RE = /Googlebot|Bingbot|Applebot|DuckDuckBot|YandexBot|Slurp|facebookexternalhit|LinkedInBot/i

const RATE_LIMIT_HTML = `<!DOCTYPE html><html><head><title>Too Many Requests</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0"><div style="text-align:center;max-width:400px;padding:2rem"><h1 style="font-size:1.5rem">Too Many Requests</h1><p style="color:#666">You're browsing too fast. Please wait a moment and try again.</p></div></body></html>`

function stripLocalePrefix(pathname: string): string {
  for (const locale of KNOWN_LOCALES) {
    if (pathname === `/${locale}`) {
      return '/'
    }
    if (pathname.startsWith(`/${locale}/`)) {
      return pathname.slice(locale.length + 1)
    }
  }

  return pathname
}

export function isLikelyCrawler(request: NextRequest): boolean {
  const userAgent = request.headers.get('user-agent') ?? ''
  return CRAWLER_RE.test(userAgent)
}

export function getClientIp(request: Request): string {
  const cfConnectingIp = request.headers.get('cf-connecting-ip')
  if (cfConnectingIp) {
    return cfConnectingIp
  }

  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  return request.headers.get('x-real-ip') ?? 'unknown'
}

const SOFT_LIMIT = { windowMs: 60_000, maxRequests: 30 }
const SOFT_LIMIT_PREFIXES = ['/brands/']

function getSoftRateLimitPathPrefix(pathname: string): string {
  const firstSegment = pathname.split('/').filter(Boolean)[0]
  return firstSegment ? `/${firstSegment}/` : '/'
}

export async function checkSoftRateLimit(request: NextRequest): Promise<boolean> {
  const normalizedPathname = stripLocalePrefix(request.nextUrl.pathname)

  if (!SOFT_LIMIT_PREFIXES.some((prefix) => normalizedPathname.startsWith(prefix))) {
    return false
  }

  if (request.headers.get('Next-Router-Prefetch') === '1') {
    return false
  }

  if (isLikelyCrawler(request)) {
    return false
  }

  const ip = getClientIp(request)
  const key = `soft:${getSoftRateLimitPathPrefix(normalizedPathname)}:${ip}`
  const result = await rateLimiter.check(key, SOFT_LIMIT.windowMs, SOFT_LIMIT.maxRequests)

  return !result.allowed
}

export async function checkRateLimit(request: NextRequest): Promise<NextResponse | null> {
  const { pathname } = request.nextUrl
  const normalizedPathname = stripLocalePrefix(pathname)

  // Find the most specific matching rule
  const ruleKey = Object.keys(RATE_LIMIT_RULES)
    .filter((prefix) => normalizedPathname.startsWith(prefix))
    .sort((a, b) => b.length - a.length)[0]

  if (!ruleKey) return null

  const isProtectedRoute = ruleKey.startsWith('/api/') || ruleKey.startsWith('/admin/')
  if (!isProtectedRoute && isLikelyCrawler(request)) {
    return null
  }

  const rule = RATE_LIMIT_RULES[ruleKey]
  const ip = getClientIp(request)
  const key = `${normalizedPathname}:${ip}`

  const result = await rateLimiter.check(key, rule.windowMs, rule.maxRequests)

  if (!result.allowed) {
    const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000)
    const headers = {
      'Retry-After': String(retryAfter),
      'X-RateLimit-Limit': String(rule.maxRequests),
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String(result.resetAt),
    }

    if (!isProtectedRoute) {
      return new NextResponse(RATE_LIMIT_HTML, {
        status: 429,
        headers: {
          ...headers,
          'Content-Type': 'text/html; charset=utf-8',
        },
      })
    }

    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers,
      }
    )
  }

  return null
}
