import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { NextRequest, NextResponse } from 'next/server'
import { CRAWLER_REGISTRY, matchCrawler } from './crawler-registry'
import { isCrawlerVerificationEnforced, isVerifiedCrawler } from './verified-crawler'
import { reportCrawlerChallenged, reportCrawlerRateLimited, reportCrawlerVerificationDisagreement } from './crawler-drift'

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

let rateLimiter = createRateLimiter()

/**
 * Test seam: pin the backing store. Without it a suite silently exercises
 * Upstash or the in-memory fallback depending on whether UPSTASH_REDIS_REST_URL
 * happens to be set in the ambient environment, which makes rate-limit
 * assertions environment-dependent. Passing null restores the env-selected store.
 */
export function setRateLimitStoreForTests(store: RateLimitStore | null): void {
  rateLimiter = store
    ? { check: (key, windowMs, maxRequests) => Promise.resolve(store.check(key, windowMs, maxRequests)) }
    : createRateLimiter()
}

export async function rateLimit(
  identifier: string,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const key = options.prefix ? `${options.prefix}:${identifier}` : identifier
  return rateLimiter.check(key, options.windowMs, options.maxRequests)
}

/**
 * Launch-day knobs. Both limits are per-IP, and TW carrier CGNAT puts many
 * unrelated users behind one egress IP — so these are sized for a NAT crowd,
 * not a single browser. Overridable via env so they can be retuned from
 * Railway without a code deploy.
 */
function envLimit(name: string, fallback: number): number {
  const parsed = Number(process.env[name])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * `crawlerExempt` is per-rule and opt-IN, so a new rule is never exemptible by
 * accident: a route only hands out the crawler bypass when its own entry says
 * so. Protected routes (`/api/`, `/admin/`) are false because the bypass keys
 * off a spoofable User-Agent, and `/sitemap.xml` is false because its 3/min
 * budget exists precisely to stop sitemap scraping — exempting it would turn
 * the tightest budget in the table into no budget at all.
 */
type RateLimitRule = { windowMs: number; maxRequests: number; crawlerExempt: boolean }

const BRANDS_DIRECTORY_RATE_LIMIT = 30

// Rate limit rules per path prefix
const RATE_LIMIT_RULES: Record<string, RateLimitRule> = {
  '/admin/operations': { windowMs: 60_000, maxRequests: 3, crawlerExempt: false },
  '/api/upload': { windowMs: 60_000, maxRequests: 20, crawlerExempt: false },
  '/api/': { windowMs: 60_000, maxRequests: 60, crawlerExempt: false },
  '/brands': {
    windowMs: 60_000,
    maxRequests: BRANDS_DIRECTORY_RATE_LIMIT,
    crawlerExempt: false,
  },
  '/brands/': {
    windowMs: 60_000,
    maxRequests: envLimit('RATE_LIMIT_BRANDS_PER_MIN', 200),
    crawlerExempt: true,
  },
  '/sitemap.xml': { windowMs: 60_000, maxRequests: 3, crawlerExempt: false },
}

const KNOWN_LOCALES = ['en', 'zh-TW']

// Ceiling: while `VERIFIED_CRAWLER_SHADOW` is ON, this union means all 33
// registry UA tokens -- including the 20 newly added ones such as CCBot -- earn
// the `/brands/` rate-limit exemption and the soft-limit bypass on nothing more
// than a spoofable User-Agent header. That is the plan's intended behavior for
// this revision (derive CRAWLER_RE from the registry), not an oversight; the
// exemption is scoped to rules marked `crawlerExempt`, so `/api/`, `/admin/`
// and `/sitemap.xml` are unaffected.
// Upgrade path: ship the Cloudflare transform rule that stamps the verified-bot
// header, confirm it has been observed, then flip `VERIFIED_CRAWLER_SHADOW=off`.
// After that only Cloudflare-verified bots plus the two `trustedUnverified`
// registry entries qualify, and the UA union stops granting anything.
const CRAWLER_RE = new RegExp(
  CRAWLER_REGISTRY.map(({ uaPattern }) => uaPattern.source).join('|'),
  'i',
)

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

/**
 * Next's client router can issue requests that look like document requests to
 * the edge. They still need middleware processing, but must not consume the
 * public document budget used to protect direct brand-page loads.
 */
export function isRouterRequest(request: Request): boolean {
  return (
    request.headers.get('RSC') === '1' ||
    request.headers.get('next-router-prefetch') === '1' ||
    request.headers.has('next-action') ||
    request.headers.has('next-url') ||
    request.headers.get('accept') === '*/*'
  )
}

/**
 * Structural shape shared by `Headers` and Next's `ReadonlyHeaders`, so Server
 * Actions (which have no `Request`) can resolve the client IP the same way
 * route handlers and middleware do.
 */
type HeaderReader = { get(name: string): string | null }

export function getClientIpFromHeaders(headerList: HeaderReader): string {
  const cfConnectingIp = headerList.get('cf-connecting-ip')
  if (cfConnectingIp) {
    return cfConnectingIp
  }

  const forwarded = headerList.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  return headerList.get('x-real-ip') ?? 'unknown'
}

export function getClientIp(request: Request): string {
  return getClientIpFromHeaders(request.headers)
}

const SOFT_LIMIT = {
  windowMs: 60_000,
  maxRequests: envLimit('SOFT_LIMIT_BRANDS_PER_MIN', 150),
}
const SOFT_LIMIT_PREFIXES = ['/brands/']

function getSoftRateLimitPathPrefix(pathname: string): string {
  const firstSegment = pathname.split('/').filter(Boolean)[0]
  return firstSegment ? `/${firstSegment}/` : '/'
}

/**
 * Alarm evaluation for the two "must never happen" crawler outcomes, extracted
 * from the limiter bodies so each alarm is an independently callable unit.
 *
 * Why a seam rather than restructuring the exemption: both alarms sit behind an
 * early return that exists to PROTECT crawlers, and the only ways to reach them
 * inline are to narrow who gets exempted (moves the privilege boundary) or to
 * run the limiter for exempt crawlers anyway (a store round-trip added to every
 * crawler request, purely to observe a counter nobody acts on). Extracting the
 * evaluation keeps the alarm executable -- and therefore provable under the
 * plan's forced test -- while leaving who gets rate-limited exactly as it was.
 *
 * Both are also live in production: `evaluateCrawlerRateLimitAlarm` fires today
 * on /api/ and /admin/ (protected routes take no exemption) and on /brands/ the
 * moment the shadow flag flips, and `evaluateCrawlerChallengeAlarm` fires if the
 * soft-limit crawler bypass is ever narrowed to verified-only.
 */
export function evaluateCrawlerRateLimitAlarm(userAgent: string, pathname: string): boolean {
  const entry = matchCrawler(userAgent)
  if (!entry) return false
  reportCrawlerRateLimited({ crawlerName: entry.name, pathname })
  return true
}

export function evaluateCrawlerChallengeAlarm(userAgent: string, pathname: string): boolean {
  const entry = matchCrawler(userAgent)
  if (!entry) return false
  reportCrawlerChallenged({ crawlerName: entry.name, pathname })
  return true
}

export async function checkSoftRateLimit(request: NextRequest): Promise<boolean> {
  const normalizedPathname = stripLocalePrefix(request.nextUrl.pathname)

  if (!SOFT_LIMIT_PREFIXES.some((prefix) => normalizedPathname.startsWith(prefix))) {
    return false
  }

  if (isLikelyCrawler(request)) {
    // Close the deindexing vector: soft challenge -> 302 to /challenge -> noindex.
    return false
  }

  const ip = getClientIp(request)
  const key = `soft:${getSoftRateLimitPathPrefix(normalizedPathname)}:${ip}`
  const result = await rateLimiter.check(key, SOFT_LIMIT.windowMs, SOFT_LIMIT.maxRequests)

  if (!result.allowed) {
    // Defense in depth: the crawler bypass above returns false for every registry
    // match, so this only fires if that bypass is ever narrowed to verified-only
    // -- the exact path that deindexes /brands/*. The alarm is proven by calling
    // `evaluateCrawlerChallengeAlarm` directly rather than by weakening the bypass.
    evaluateCrawlerChallengeAlarm(request.headers.get('user-agent') ?? '', normalizedPathname)
    return true
  }

  return false
}

function matchesRateLimitRule(pathname: string, ruleKey: string): boolean {
  if (ruleKey.endsWith('/')) return pathname.startsWith(ruleKey)
  return pathname === ruleKey || pathname.startsWith(`${ruleKey}/`)
}

export async function checkRateLimit(request: NextRequest): Promise<NextResponse | null> {
  const { pathname } = request.nextUrl
  const normalizedPathname = stripLocalePrefix(pathname)

  // Cron handlers authenticate machine callers before doing any work. Keeping
  // them off the shared external limiter also prevents a Redis outage or quota
  // exhaustion from disabling scheduled operations before authentication runs.
  if (normalizedPathname.startsWith('/api/cron/')) return null

  // Find the most specific matching rule
  const ruleKey = Object.keys(RATE_LIMIT_RULES)
    .filter((prefix) => matchesRateLimitRule(normalizedPathname, prefix))
    .sort((a, b) => b.length - a.length)[0]

  if (!ruleKey) return null

  const rule = RATE_LIMIT_RULES[ruleKey]
  // `isProtectedRoute` still decides the router-request bypass and the 429 body
  // shape (JSON for APIs, HTML for documents). Who may skip the limiter entirely
  // is now the rule's own `crawlerExempt` flag -- the two questions were fused
  // into one prefix test, which silently exempted `/sitemap.xml`.
  const isProtectedRoute = ruleKey.startsWith('/api/') || ruleKey.startsWith('/admin/')
  if (!isProtectedRoute && isRouterRequest(request)) {
    return null
  }

  if (rule.crawlerExempt) {
    const userAgent = request.headers.get('user-agent') ?? ''
    const entry = matchCrawler(userAgent)
    // CRAWLER_RE is the union of the same `uaPattern` sources `matchCrawler`
    // scans, so `entry !== null` is exactly `isLikelyCrawler(request)` -- one
    // scan of the UA per request instead of three.
    const claimsCrawler = entry !== null
    const verified = isVerifiedCrawler(request)
    // While shadow is ON the header is read and compared but does NOT decide:
    // the UA match stays operative, so behavior is unchanged at this revision.
    // `isCrawlerVerificationEnforced` also refuses to leave shadow until the
    // Cloudflare header has been observed at least once (see verified-crawler).
    const enforced = isCrawlerVerificationEnforced()
    reportCrawlerVerificationDisagreement({
      crawlerName: entry?.name ?? null,
      userAgentClaimsCrawler: claimsCrawler,
      verified,
    })
    const exempt = enforced
      ? verified || entry?.trustedUnverified === true
      : claimsCrawler
    if (exempt) return null
  }

  const ip = getClientIp(request)
  const key = `${normalizedPathname}:${ip}`

  const result = await rateLimiter.check(key, rule.windowMs, rule.maxRequests)

  if (!result.allowed) {
    evaluateCrawlerRateLimitAlarm(request.headers.get('user-agent') ?? '', normalizedPathname)
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
