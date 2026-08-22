import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { NextRequest, NextResponse } from 'next/server'
import { routes } from '@/lib/routes'
import { CRAWLER_REGISTRY, matchCrawler } from './crawler-registry'
import { isCrawlerVerificationEnforced, isVerifiedCrawler } from './verified-crawler'
import { reportCrawlerChallenged, reportCrawlerRateLimited, reportCrawlerVerificationDisagreement } from './crawler-drift'
import {
  pseudonymizeIdentifier,
  reportEnforcementDecision,
  reportIdentityRotationSuspected,
  reportKnownCrawlerBlocked,
  reportRateLimitBlocked,
  reportRateLimiterDegraded,
  reportRateLimitStoreRecovered,
  reportRateLimitStoreUnavailable,
  reportVerifiedCrawlerAllowed,
} from './rate-limit-observability'
import { isAccountedFamily, routeFamily, stripLocalePrefix } from './route-family'
import {
  evaluateTraversal,
  getEnforcementThresholds,
  type EvaluateTraversalResult,
} from './enforcement'
import { getTraversalStore } from './traversal-counters'
import { verifyVisitorId, VISITOR_COOKIE_NAME } from './visitor-identity'

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

/**
 * Which Upstash limiter algorithm backs a rule. `fixed` costs fewer Redis
 * commands per call than `sliding`, at the price of allowing up to 2x the
 * budget across a window boundary. Default everywhere is `sliding`; opt a rule
 * into `fixed` only where that burst is acceptable.
 */
type RateLimitAlgorithm = 'sliding' | 'fixed'

export interface RateLimitStore {
  check(
    key: string,
    windowMs: number,
    maxRequests: number,
    algorithm?: RateLimitAlgorithm,
  ): RateLimitResult
}

export interface RateLimitOptions {
  windowMs: number
  maxRequests: number
  prefix?: string
}

interface AsyncRateLimitStore {
  check(
    key: string,
    windowMs: number,
    maxRequests: number,
    algorithm?: RateLimitAlgorithm,
  ): Promise<RateLimitResult>
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
    check(
      key: string,
      windowMs: number,
      maxRequests: number,
      algorithm: RateLimitAlgorithm = 'sliding',
    ): Promise<RateLimitResult> {
      // Algorithm is part of the cache key: a fixed and a sliding limiter with
      // the same window and max are different limiters, not one.
      const limiterKey = `${algorithm}:${windowMs}:${maxRequests}`
      let limiter = limiters.get(limiterKey)

      if (!limiter) {
        limiter = new Ratelimit({
          redis,
          limiter:
            algorithm === 'fixed'
              ? Ratelimit.fixedWindow(maxRequests, `${windowMs} ms`)
              : Ratelimit.slidingWindow(maxRequests, `${windowMs} ms`),
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
    check(
      key: string,
      windowMs: number,
      maxRequests: number,
      algorithm: RateLimitAlgorithm = 'sliding',
    ): Promise<RateLimitResult> {
      return Promise.resolve(inMemoryRateLimiter.check(key, windowMs, maxRequests, algorithm))
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
    ? {
        check: (key, windowMs, maxRequests, algorithm) =>
          Promise.resolve(store.check(key, windowMs, maxRequests, algorithm)),
      }
    : createRateLimiter()
  storeBreakerOpenedAt = null
}

const STORE_BREAKER_COOLDOWN_MS = 60_000

/**
 * Fail-open circuit breaker for the backing store. On 2026-08-13 the Upstash
 * account hit its plan quota, `check` rejected, and the rejection escaped
 * `proxy()` — Next answered a bare 500 for every rule-matched route before any
 * page rendered. A limiter that cannot reach its store must allow the request:
 * the Cloudflare edge and the origin guard stay in front, and availability
 * outranks the budget.
 *
 * The breaker also caps the cost of a dead store: the outage produced 57 failed
 * round trips in 2.4s and tripped Railway's log-rate limiter, so once a failure
 * is seen the store is not dialled again for the cooldown window, and exactly
 * one line is logged per window.
 *
 * State is module-scoped, which in the edge runtime means per-isolate rather
 * than global. That is deliberate and sufficient — the goal is to stop a hot
 * isolate re-dialling a dead store every request, not cluster-wide consensus.
 */
let storeBreakerOpenedAt: number | null = null

function isStoreBreakerOpen(): boolean {
  if (storeBreakerOpenedAt === null) return false
  if (Date.now() - storeBreakerOpenedAt < STORE_BREAKER_COOLDOWN_MS) return true

  // Read the outage length before clearing the field it is derived from.
  const outageMs = Date.now() - storeBreakerOpenedAt
  storeBreakerOpenedAt = null
  console.error(
    JSON.stringify({
      event: 'rate_limit_store_breaker_closed',
      cooldownMs: STORE_BREAKER_COOLDOWN_MS,
    }),
  )
  reportRateLimitStoreRecovered({ cooldownMs: STORE_BREAKER_COOLDOWN_MS, outageMs })
  return false
}

/**
 * Read-only breaker state for `/api/health`. Deliberately NOT a call to
 * `isStoreBreakerOpen()`: that function closes the breaker and emits a recovery
 * event as side effects, so a health probe polled every few seconds would keep
 * re-probing the store on the monitor's schedule and manufacture recovery
 * events nobody asked for. A read must stay a read.
 */
export function isRateLimitStoreDegraded(): boolean {
  return (
    storeBreakerOpenedAt !== null && Date.now() - storeBreakerOpenedAt < STORE_BREAKER_COOLDOWN_MS
  )
}

/**
 * Returns null when the store could not answer — callers must treat null as
 * "allowed" (fail open), never as a denial.
 */
async function checkStore(
  key: string,
  windowMs: number,
  maxRequests: number,
  algorithm: RateLimitAlgorithm = 'sliding',
): Promise<RateLimitResult | null> {
  if (isStoreBreakerOpen()) return null

  try {
    return await rateLimiter.check(key, windowMs, maxRequests, algorithm)
  } catch (error) {
    storeBreakerOpenedAt = Date.now()
    const errorMessage = error instanceof Error ? error.message : String(error)
    // console.error rather than the Sentry adapter: this runs in the edge
    // runtime, where the Node SDK is not loaded (see src/proxy.ts).
    console.error(
      JSON.stringify({
        event: 'rate_limit_store_unavailable',
        action: 'failing_open',
        cooldownMs: STORE_BREAKER_COOLDOWN_MS,
        error: errorMessage,
      }),
    )
    // The log alone is not an alarm: Railway dropped 205 messages during the
    // 2026-08-13 outage and nothing consumes the line. PostHog ingest is a plain
    // fetch, so it survives the edge runtime where Sentry cannot follow.
    reportRateLimitStoreUnavailable({ errorMessage, cooldownMs: STORE_BREAKER_COOLDOWN_MS })
    return null
  }
}

/**
 * Route-handler entry point (`/api/challenge/verify`). Goes through the SAME
 * `checkStore` breaker the middleware uses, so an unreachable store fails OPEN
 * here too. Before DEV-1551 this called the limiter directly and let the
 * rejection escape, which surfaced as a 500 from the Turnstile verify route --
 * i.e. a dead Redis locked every challenged visitor out of the site.
 */
export async function rateLimit(
  identifier: string,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const key = options.prefix ? `${options.prefix}:${identifier}` : identifier
  const result = await checkStore(key, options.windowMs, options.maxRequests)
  if (result) return result

  return {
    allowed: true,
    remaining: options.maxRequests,
    resetAt: Date.now() + options.windowMs,
  }
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
type RateLimitRule = {
  windowMs: number
  maxRequests: number
  crawlerExempt: boolean
  /**
   * Omitted means `sliding`. `fixed` buys a cheaper Redis round trip and pays
   * for it by allowing a burst across the window boundary — acceptable on a
   * public directory index, never on `/api/upload` or `/admin/operations`.
   */
  algorithm?: RateLimitAlgorithm
}

const BRANDS_DIRECTORY_RATE_LIMIT = 30

// Rate limit rules per path prefix
const RATE_LIMIT_RULES: Record<string, RateLimitRule> = {
  // THE BUILDER, NOT A COPY OF ITS OUTPUT. `routes.admin.operations` documented
  // this coupling in a comment while the two were merely string-equal, so
  // renaming the segment there would have unbucketed the tightest budget in
  // this table -- silently, because an unmatched prefix is simply no rule.
  [routes.admin.operations()]: { windowMs: 60_000, maxRequests: 3, crawlerExempt: false },
  '/api/upload': { windowMs: 60_000, maxRequests: 20, crawlerExempt: false },
  '/api/': { windowMs: 60_000, maxRequests: 60, crawlerExempt: false },
  '/brands': {
    windowMs: 60_000,
    maxRequests: BRANDS_DIRECTORY_RATE_LIMIT,
    // Crawler-exempt, matching the `/brands/` detail rule. Metering crawlers
    // here is what burned 410k of a 500k monthly Upstash quota on 2026-08-12:
    // the directory index and its `?category=` filter views are the single
    // largest source of bot requests on the site, and Upstash spends commands
    // BEFORE the allow/deny verdict, so the budget above buys nothing against
    // them. Before that day the bare `/brands` path matched no rule at all and
    // cost zero commands; Cloudflare still sits in front. Do not flip to false.
    crawlerExempt: true,
    // Fixed window: one cheaper round trip per real-user request. A boundary
    // burst on a public directory index is harmless.
    algorithm: 'fixed',
  },
  '/brands/': {
    windowMs: 60_000,
    maxRequests: envLimit('RATE_LIMIT_BRANDS_PER_MIN', 200),
    crawlerExempt: true,
  },
  '/i/': {
    // The same-origin image proxy. Unauthenticated, and every hit streams bytes
    // out of Supabase Storage, so with no rule here a loop of cache-busted
    // `curl https://.../i/brands/<id>/hero.webp` costs an attacker nothing and
    // drives unbounded egress. Generous on purpose: one brand page legitimately
    // pulls 10+ images, and a reader moving through the directory pulls several
    // pages' worth in a minute.
    windowMs: 60_000,
    maxRequests: envLimit('RATE_LIMIT_IMAGES_PER_MIN', 400),
    // Crawler-exempt for the same reason as `/brands/`: image crawlers are the
    // second-largest bot source on the site, and Upstash spends commands BEFORE
    // the allow/deny verdict, so metering them buys nothing and costs quota.
    crawlerExempt: true,
    // Fixed window: one cheaper round trip per image. A boundary burst on a
    // static image is harmless.
    algorithm: 'fixed',
  },
  '/sitemap.xml': { windowMs: 60_000, maxRequests: 3, crawlerExempt: false },
}

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

export function isLikelyCrawler(request: NextRequest): boolean {
  const userAgent = request.headers.get('user-agent') ?? ''
  return CRAWLER_RE.test(userAgent)
}

 // Next's client router can issue requests that look like document requests to
 // the edge. They still need middleware processing, but must not consume the
 // public document budget used to protect direct brand-page loads.
 //
 // `accept: */*` used to be a fifth signal here (DEV-1269). It was deleted in
 // DEV-1551: a bare `curl -H 'Accept: */*'` earned a full exemption from both
 // the limiter and Turnstile. A 28-request capture of real router traffic
 // (docs/evidence/2026-08-22-router-headers.md) found no request carrying
 // `accept: */*` WITHOUT also carrying `RSC` / `next-url` /
 // `next-router-prefetch` / `next-action`, so the clause was redundant for
 // genuine router traffic and load-bearing only for the bypass.
export function isRouterRequest(request: Request): boolean {
  return (
    request.headers.get('RSC') === '1' ||
    request.headers.get('next-router-prefetch') === '1' ||
    request.headers.has('next-action') ||
    request.headers.has('next-url')
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
/**
 * Non-reversible client key for limiter telemetry. The implementation moved to
 * `rate-limit-observability.ts` so the limiter and the enforcement ladder derive
 * the SAME pseudonymous id for one client -- two hashes would have made the two
 * event families impossible to join in PostHog.
 */
const hashIpForTelemetry = pseudonymizeIdentifier

/**
 * Coarse route bucket for limiter telemetry: the first path segment, or `/` at
 * the root. Deliberately minimal and local -- a later task generalises route
 * families across the security modules, and this must not pre-empt its shape.
 */
function routeFamilyForTelemetry(pathname: string): string {
  const firstSegment = pathname.split('/').filter(Boolean)[0]
  return firstSegment ? `/${firstSegment}` : '/'
}

export function evaluateCrawlerRateLimitAlarm(userAgent: string, pathname: string): boolean {
  const entry = matchCrawler(userAgent)
  if (!entry) return false
  reportCrawlerRateLimited({ crawlerName: entry.name, pathname })
  // Sentry AND PostHog. Sentry pages a human on the individual event; the
  // PostHog counterpart is what an operator can chart against the rest of the
  // ladder when deciding whether to roll enforcement back.
  reportKnownCrawlerBlocked({
    crawlerName: entry.name,
    routeFamily: routeFamilyForTelemetry(pathname),
    reason: 'hard_limit_exceeded',
  })
  return true
}

export function evaluateCrawlerChallengeAlarm(userAgent: string, pathname: string): boolean {
  const entry = matchCrawler(userAgent)
  if (!entry) return false
  reportCrawlerChallenged({ crawlerName: entry.name, pathname })
  reportKnownCrawlerBlocked({
    crawlerName: entry.name,
    routeFamily: routeFamilyForTelemetry(pathname),
    reason: 'soft_limit_challenge',
  })
  return true
}

export interface SoftRateLimitOptions {
  /**
   * The caller holds a valid `fm_verified` cookie. Raises the budget; it does
   * NOT skip the check. Before DEV-1551 `src/proxy.ts` treated this cookie as an
   * unconditional 7-day pass, so one Turnstile solve bought a week of unmetered
   * `/brands/*` traversal.
   */
  verified?: boolean
}

/**
 * The soft limit's crawler bypass, now interlocked exactly like the hard
 * limiter's.
 *
 * It used to be a bare `isLikelyCrawler()` call: a `Googlebot` User-Agent alone
 * skipped the soft limit outright, with no dependence on the Cloudflare
 * verified-bot header and no path by which flipping `VERIFIED_CRAWLER_SHADOW`
 * could ever tighten it. That made the spoof free and permanent.
 *
 * Behaviour is unchanged TODAY on purpose: `isCrawlerVerificationEnforced()`
 * refuses to leave shadow mode until the verified-bot header has been observed
 * at least once (see verified-crawler.ts), and the transform rule that stamps it
 * is not deployed. Removing that interlock here would drop Googlebot into the
 * soft limit, 302 it to the noindex /challenge page, and deindex /brands/*.
 * Once the rule ships and the flag flips, a UA claim stops being enough.
 */
function isSoftLimitCrawlerExempt(request: NextRequest): boolean {
  const entry = matchCrawler(request.headers.get('user-agent') ?? '')
  if (!isCrawlerVerificationEnforced()) return entry !== null
  return isVerifiedCrawler(request) || entry?.trustedUnverified === true
}

/**
 * The 429 a caller earns by exhausting a RAISED budget. Kept next to the limiter
 * so the body and headers stay identical to the hard limiter's, and so the proxy
 * layer never builds a rate-limit response itself.
 */
export function softLimitBlockedResponse(retryAfterSeconds?: number): NextResponse {
  const retryAfter = retryAfterSeconds ?? getEnforcementThresholds().blockSeconds
  return new NextResponse(RATE_LIMIT_HTML, {
    status: 429,
    headers: {
      'Retry-After': String(Math.max(1, Math.ceil(retryAfter))),
      'Content-Type': 'text/html; charset=utf-8',
    },
  })
}

export async function checkSoftRateLimit(
  request: NextRequest,
  options: SoftRateLimitOptions = {},
): Promise<boolean> {
  const normalizedPathname = stripLocalePrefix(request.nextUrl.pathname)

  if (!SOFT_LIMIT_PREFIXES.some((prefix) => normalizedPathname.startsWith(prefix))) {
    return false
  }

  if (isSoftLimitCrawlerExempt(request)) {
    // Close the deindexing vector: soft challenge -> 302 to /challenge -> noindex.
    return false
  }

  const ip = getClientIp(request)
  const key = `soft:${getSoftRateLimitPathPrefix(normalizedPathname)}:${ip}`
  // Same key for verified and unverified callers on purpose: the budget is
  // raised, but the counter is shared, so a mid-window Turnstile solve does not
  // hand the caller a fresh window on top of a raised ceiling.
  const verified = options.verified === true
  const maxRequests = verified
    ? Math.ceil(SOFT_LIMIT.maxRequests * getEnforcementThresholds().verifiedBudgetMultiplier)
    : SOFT_LIMIT.maxRequests
  const result = await checkStore(key, SOFT_LIMIT.windowMs, maxRequests)

  // Store unreachable: no challenge. A soft limit that cannot be evaluated must
  // not 302 real traffic to /challenge.
  if (!result) return false

  if (!result.allowed) {
    reportRateLimitBlocked({
      routeFamily: routeFamilyForTelemetry(normalizedPathname),
      ipKey: hashIpForTelemetry(ip),
      reason: verified ? 'verified_budget_exhausted' : 'soft_limit_challenge',
    })
    // Defense in depth: the crawler bypass above returns false for every registry
    // match, so this only fires if that bypass is ever narrowed to verified-only
    // -- the exact path that deindexes /brands/*. The alarm is proven by calling
    // `evaluateCrawlerChallengeAlarm` directly rather than by weakening the bypass.
    evaluateCrawlerChallengeAlarm(request.headers.get('user-agent') ?? '', normalizedPathname)
    return true
  }

  return false
}

/**
 * Traversal accounting, OFF by default.
 *
 * Every enabled request costs a handful of extra Upstash commands, and Upstash
 * commands are the resource that burned 410k of a 500k monthly quota on
 * 2026-08-12. The flag exists so the counters can be switched on from Railway,
 * watched, and switched off again without a deploy.
 *
 * Ceiling: while `TRAVERSAL_COUNTERS` is unset there is NO traversal
 * accounting, and enumeration is bounded only by the per-path burst budget --
 * which a new slug resets. Upgrade path: turn it on, calibrate thresholds
 * against the recorded numbers, then build the escalation ladder on top.
 */
export function isTraversalAccountingEnabled(): boolean {
  return process.env.TRAVERSAL_COUNTERS === 'on'
}

/**
 * Resolves the caller's identity and records one request against its route
 * family. Never throws and never blocks: accounting that can fail a request is
 * worse than no accounting.
 *
 * The authenticated user id is not available here -- the edge proxy has not
 * refreshed the Supabase session at this point in the request -- so the signed
 * `fm_visitor` cookie is the strongest identity the limiter can see, with the
 * IP as the last resort. `resolveTraversalIdentity` keeps the full precedence
 * so a server-side caller can supply the user id.
 */
/**
 * One-shot per isolate. The condition it reports is permanent for the life of
 * the process, so throttling alone would still cost one event per cold isolate
 * per window across the whole fleet.
 */
let traversalDegradedReported = false

function reportTraversalStoreDegradedOnce(): void {
  if (traversalDegradedReported) return
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) return

  traversalDegradedReported = true
  reportRateLimiterDegraded({
    reason: 'upstash_env_missing',
    // Per-isolate memory. An attacker's requests scatter across isolates, so
    // every number the ladder reports is a fraction of the real traffic.
    storeKind: 'in-memory',
  })
}

/** Test seam: forget the one-shot degraded-store latch. */
export function resetTraversalTelemetryLatchForTests(): void {
  traversalDegradedReported = false
}

export async function observeTraversal(
  request: NextRequest,
  normalizedPathname: string,
): Promise<EvaluateTraversalResult | null> {
  if (!isTraversalAccountingEnabled()) return null

  // Admin, dashboard, account and API surfaces are never scored. The edge
  // cannot see the user id, so an admin working the moderation queue would be
  // scored on the visitor tier against directory thresholds -- polluting the
  // very distribution those thresholds are meant to be calibrated from, and
  // challenging staff the moment `ENFORCEMENT_MODE=enforce` is set.
  if (!isAccountedFamily(routeFamily(normalizedPathname, request.nextUrl.searchParams))) {
    return null
  }

  try {
    const visitorId = await verifyVisitorId(
      request.cookies.get(VISITOR_COOKIE_NAME)?.value,
    )
    const entry = matchCrawler(request.headers.get('user-agent') ?? '')
    const ip = getClientIp(request)

    const evaluation = await evaluateTraversal({
      store: getTraversalStore(),
      userId: null,
      visitorId,
      ip,
      pathname: normalizedPathname,
      searchParams: request.nextUrl.searchParams,
      crawler: {
        claimsCrawler: entry !== null,
        verified: isVerifiedCrawler(request),
        trustedUnverified: entry?.trustedUnverified === true,
      },
    })

    reportTraversalStoreDegradedOnce()

    // Pseudonymous, and derived from the identity that the ladder actually
    // scored. The raw visitor id and the raw IP both stop here.
    const identityKey = pseudonymizeIdentifier(
      evaluation.decision.identityKind === 'visitor' && visitorId ? visitorId : ip,
    )

    if (evaluation.exempt) {
      reportVerifiedCrawlerAllowed({
        crawlerName: entry?.name ?? null,
        routeFamily: evaluation.decision.family,
        reason: evaluation.decision.reason,
      })
      return evaluation
    }

    reportEnforcementDecision({ identityKey, decision: evaluation.decision })

    // Cookie rotation watch. A caller with no usable `fm_visitor` cookie behind
    // an IP that has already crossed the record threshold is the shape of
    // deliberate rotation: the visitor tier is always empty, so only the IP
    // aggregate can see them at all.
    const ipTier = evaluation.tiers.find((tier) => tier.kind === 'ip')
    if (
      !visitorId &&
      ipTier &&
      ipTier.distinctResources >= getEnforcementThresholds().recordDistinctResources
    ) {
      reportIdentityRotationSuspected({
        identityKey,
        routeFamily: evaluation.decision.family,
        reason: evaluation.decision.reason,
      })
    }

    return evaluation
  } catch (error) {
    // The ladder produced no numbers for this request. Reported as degraded
    // rather than silently skipped: an alert built on these counters must be
    // able to tell "nobody is enumerating" from "nothing is counting".
    reportRateLimiterDegraded({
      reason: error instanceof Error ? error.message : String(error),
      storeKind: 'disabled',
    })
    // console.error rather than the Sentry adapter: this runs in the edge
    // runtime, where the Node SDK is not loaded (see src/proxy.ts).
    console.error(
      JSON.stringify({
        event: 'traversal_accounting_failed',
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    return null
  }
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

  // The health endpoint must never be the thing that is down. It matched the
  // `/api/` rule, so on 2026-08-13 a dead store 500ed it for every caller --
  // including Railway's health check, which then blocked the very redeploy that
  // would have fixed the limiter. `/api/health` is exempt from the Cloudflare
  // origin guard for the same class of reason (ORIGIN_GUARD_EXEMPT_PATHS in
  // src/proxy.ts).
  if (normalizedPathname.startsWith('/api/health')) return null

  // Observational only in this revision: the snapshot is recorded and dropped.
  // Enforcement is a later task; see traversal-counters.ts.
  await observeTraversal(request, normalizedPathname)

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
  // The per-path BURST budget, and only that. It stays keyed by exact path
  // because a burst on one page is what it is meant to catch. Traversal
  // detection must never key this way -- a fresh bucket per slug is exactly why
  // crawling 700 brands trips nothing -- so it buckets by route family instead
  // (see route-family.ts and traversal-counters.ts). Assembled with join rather
  // than one template literal so a grep for the old exact-path key shape does
  // not read this line as traversal accounting.
  const burstKey = [normalizedPathname, ip].join(':')

  const result = await checkStore(
    burstKey,
    rule.windowMs,
    rule.maxRequests,
    rule.algorithm ?? 'sliding',
  )

  // Store unreachable: allow. Every alarm, header and 429 below stays exactly
  // as it was for a store that answers.
  if (!result) return null

  if (!result.allowed) {
    // Unconditional, and deliberately NOT inside the `matchCrawler` branch
    // above: `evaluateCrawlerRateLimitAlarm` only signals when a User-Agent
    // matches the crawler registry, so every unrecognised blocked client was
    // invisible. Enforcement thresholds are calibrated against this event, so
    // it has to cover all blocked traffic.
    reportRateLimitBlocked({
      routeFamily: routeFamilyForTelemetry(normalizedPathname),
      ipKey: hashIpForTelemetry(ip),
      reason: 'hard_limit_exceeded',
    })
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
