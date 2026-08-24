import { Redis } from '@upstash/redis'

import { classifyRoute, type RouteFamily } from './route-family'

/**
 * Behavioral traversal accounting: how many LOGICAL views and how many DISTINCT
 * resources one identity has pulled from one route family, over three windows.
 *
 * This module ACCOUNTS ONLY. Nothing here blocks, challenges or throttles a
 * request; the escalation ladder is built on top of these numbers in a later
 * task. Keep it that way — a counter that also enforces cannot be calibrated
 * against real traffic before it starts refusing it.
 *
 * Two quantities, because they answer different questions:
 * - logical views: request volume, with a document request and its RSC twin
 *   counted once. Next fetches both for a single navigation, so counting raw
 *   requests would double every real reader's number.
 * - distinct resources: breadth. 700 requests for one brand page is a reload
 *   loop; 700 requests for 700 brands is the directory being copied. Only the
 *   second number separates them, and dedup must never collapse it.
 */

export const TRAVERSAL_WINDOWS = {
  /** Short window: catches a scripted burst before it finishes. */
  burst: 10_000,
  tenMinutes: 600_000,
  hour: 3_600_000,
} as const

export type TraversalWindowName = keyof typeof TRAVERSAL_WINDOWS

/**
 * How long a document request and its RSC counterpart may be apart and still
 * count as one logical view. Next issues them back to back, so this is sized
 * for a navigation, not for a reading session.
 */
const DEDUP_WINDOW_MS = 5_000

const KEY_PREFIX = 'fm_tv'

export interface TraversalStore {
  /** Returns the counter value AFTER the increment. */
  increment(key: string, ttlMs: number, now: number): Promise<number>
  /** Current counter value without touching it. Absent key reads as 0. */
  peek(key: string, now: number): Promise<number>
  /** Adds a member to a set and returns the set cardinality. */
  addDistinct(key: string, member: string, ttlMs: number, now: number): Promise<number>
  /** Sets a marker if absent. True means this caller set it. */
  markOnce(key: string, ttlMs: number, now: number): Promise<boolean>
}

/**
 * DEGRADED FALLBACK, and also the test double.
 *
 * Ceiling: process memory is per-isolate. The edge runtime spins up many
 * isolates and recycles them freely, so an attacker's requests scatter across
 * instances and each one sees a fraction of the traffic. Numbers from this
 * store are a development convenience and MUST NOT be read as equivalent
 * protection to the distributed store.
 *
 * Upgrade path: set UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN, which is
 * what every deployed environment does — `createTraversalStore` then returns
 * the Redis-backed store instead and this code is never reached.
 */
export function createInMemoryTraversalStore(): TraversalStore {
  const counters = new Map<string, { value: number; expiresAt: number }>()
  const sets = new Map<string, { members: Set<string>; expiresAt: number }>()
  const marks = new Map<string, number>()

  function sweep(now: number): void {
    for (const [key, entry] of counters) if (entry.expiresAt <= now) counters.delete(key)
    for (const [key, entry] of sets) if (entry.expiresAt <= now) sets.delete(key)
    for (const [key, expiresAt] of marks) if (expiresAt <= now) marks.delete(key)
  }

  return {
    increment(key, ttlMs, now) {
      sweep(now)
      const existing = counters.get(key)
      const value = (existing?.value ?? 0) + 1
      counters.set(key, { value, expiresAt: now + ttlMs })
      return Promise.resolve(value)
    },
    peek(key, now) {
      sweep(now)
      return Promise.resolve(counters.get(key)?.value ?? 0)
    },
    addDistinct(key, member, ttlMs, now) {
      sweep(now)
      const existing = sets.get(key)
      const members = existing?.members ?? new Set<string>()
      members.add(member)
      sets.set(key, { members, expiresAt: now + ttlMs })
      return Promise.resolve(members.size)
    },
    markOnce(key, ttlMs, now) {
      sweep(now)
      if (marks.has(key)) return Promise.resolve(false)
      marks.set(key, now + ttlMs)
      return Promise.resolve(true)
    },
  }
}

/**
 * Distributed store. Same Upstash instance the rate limiter uses (same env
 * vars, different key prefix) — a client is constructed here rather than
 * imported from `rate-limiter.ts` because the limiter imports this module, and
 * importing back would close a cycle.
 *
 * Distinct resources use SADD/SCARD rather than a HyperLogLog so the count is
 * exact. Ceiling: the set holds one member per resource per window, so an
 * enumerator sweeping the whole directory costs roughly one slug of Redis
 * memory per slug read, expiring with the window. Upgrade path: switch to
 * PFADD/PFCOUNT if set memory ever shows up in the Upstash dashboard —
 * enumeration detection tolerates HyperLogLog's error rate.
 */
function createUpstashTraversalStore(redis: Redis): TraversalStore {
  return {
    async increment(key, ttlMs) {
      const results = await redis.pipeline().incr(key).pexpire(key, ttlMs).exec()
      return Number(results.at(0) ?? 0)
    },
    async peek(key) {
      const value = await redis.get<number | string | null>(key)
      return value === null || value === undefined ? 0 : Number(value)
    },
    async addDistinct(key, member, ttlMs) {
      const results = await redis
        .pipeline()
        .sadd(key, member)
        .pexpire(key, ttlMs)
        .scard(key)
        .exec()
      return Number(results.at(2) ?? 0)
    },
    async markOnce(key, ttlMs) {
      const result = await redis.set(key, '1', { nx: true, px: ttlMs })
      return result === 'OK'
    },
  }
}

let defaultStore: TraversalStore | null = null

function createTraversalStore(): TraversalStore {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return createUpstashTraversalStore(
      new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      }),
    )
  }

  console.warn(
    'Upstash Redis env vars missing; traversal counters are running on the DEGRADED in-memory store',
  )
  return createInMemoryTraversalStore()
}

export function getTraversalStore(): TraversalStore {
  defaultStore ??= createTraversalStore()
  return defaultStore
}

/** Test seam. Passing null restores the env-selected store. */
export function setTraversalStoreForTests(store: TraversalStore | null): void {
  defaultStore = store
}

export type TraversalIdentityKind = 'user' | 'visitor' | 'ip'

export interface TraversalIdentity {
  kind: TraversalIdentityKind
  value: string
  /** The bucket key. Never interpolate the raw value anywhere else. */
  key: string
}

/**
 * Identity precedence: authenticated user, then the signed `fm_visitor` cookie,
 * then the client IP.
 *
 * The IP tier is the weakest and the most collateral-prone: TW carrier CGNAT
 * puts thousands of unrelated people behind one egress address, so thresholds
 * for it must be MUCH higher than for the other two (see
 * `identityThresholdMultiplier`). It exists so a cookie-refusing client is
 * still accounted for, not so it can be treated like a browser.
 */
export function resolveTraversalIdentity(input: {
  userId?: string | null
  visitorId?: string | null
  ip?: string | null
}): TraversalIdentity {
  if (input.userId) return { kind: 'user', value: input.userId, key: `u:${input.userId}` }
  if (input.visitorId) {
    return { kind: 'visitor', value: input.visitorId, key: `v:${input.visitorId}` }
  }

  const ip = input.ip ?? 'unknown'
  return { kind: 'ip', value: ip, key: `i:${ip}` }
}

/**
 * Threshold scaling per identity tier, for the enforcement ladder that consumes
 * these counters. A shared CGNAT egress carries an entire carrier's traffic, so
 * an IP-tier threshold set at browser scale would block a city.
 */
export function identityThresholdMultiplier(kind: TraversalIdentityKind): number {
  return kind === 'ip' ? 20 : 1
}

export type TraversalWindowCounts = Record<TraversalWindowName, number>

export interface TraversalSnapshot {
  identity: TraversalIdentity
  family: RouteFamily
  resourceId: string
  /** True when this request was the RSC twin of one already counted. */
  deduplicated: boolean
  logicalViews: TraversalWindowCounts
  distinctResources: TraversalWindowCounts
}

export interface RecordTraversalInput {
  store: TraversalStore
  identity: TraversalIdentity
  pathname: string
  searchParams?: URLSearchParams | string
  now?: number
}

function windowBucket(now: number, windowMs: number): number {
  return Math.floor(now / windowMs)
}

/**
 * Records one request and returns the current picture for its identity and
 * route family. Observational: the caller may log or emit the snapshot, but
 * nothing in this revision acts on it.
 */
export async function recordTraversalView(
  input: RecordTraversalInput,
): Promise<TraversalSnapshot> {
  const now = input.now ?? Date.now()
  const { family, resourceId } = classifyRoute(input.pathname, input.searchParams)
  const base = `${KEY_PREFIX}:${input.identity.key}:${family}`

  // One logical view per resource per dedup window: the document request wins
  // the marker, its RSC twin finds it taken.
  const isFirstOfPair = await input.store.markOnce(
    `${base}:dedup:${resourceId}`,
    DEDUP_WINDOW_MS,
    now,
  )

  const windowNames = Object.keys(TRAVERSAL_WINDOWS) as TraversalWindowName[]
  const logicalViews = {} as TraversalWindowCounts
  const distinctResources = {} as TraversalWindowCounts

  for (const windowName of windowNames) {
    const windowMs = TRAVERSAL_WINDOWS[windowName]
    const suffix = `${windowName}:${windowBucket(now, windowMs)}`
    const viewsKey = `${base}:views:${suffix}`

    // Distinct resources are added unconditionally: dedup collapses the second
    // REQUEST, never the resource it names, or 100 slugs would read as fewer.
    distinctResources[windowName] = await input.store.addDistinct(
      `${base}:res:${suffix}`,
      resourceId,
      windowMs,
      now,
    )

    // A deduplicated request must not move the counter at all — incrementing
    // and subtracting one from the RETURNED value would still leave the stored
    // total inflated for every later reader.
    logicalViews[windowName] = isFirstOfPair
      ? await input.store.increment(viewsKey, windowMs, now)
      : await input.store.peek(viewsKey, now)
  }

  return {
    identity: input.identity,
    family,
    resourceId,
    deduplicated: !isFirstOfPair,
    logicalViews,
    distinctResources,
  }
}
