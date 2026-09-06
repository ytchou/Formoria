import {
  identityThresholdMultiplier,
  recordTraversalView,
  resolveTraversalIdentity,
  TRAVERSAL_WINDOWS,
  type TraversalIdentityKind,
  type TraversalSnapshot,
  type TraversalStore,
  type TraversalWindowName,
} from './traversal-counters'
import { classifyRoute, type RouteFamily } from './route-family'

/**
 * The progressive enforcement ladder.
 *
 * A pure decision module: it reads traversal counters and answers what SHOULD
 * happen. It performs no I/O beyond the injected traversal store, imports
 * nothing from `next/server`, and never constructs a response — the caller
 * turns a decision into a 429, a redirect, or a log line. That separation is
 * what lets the whole ladder be exercised in unit tests without a request.
 *
 * DEFAULT STATE IS LOG-ONLY. `ENFORCEMENT_MODE` defaults to `observe`, which
 * still computes and reports the full decision but leaves `effectiveAction` at
 * `allow`. Thresholds have never been calibrated against real traffic, and the
 * failure mode of a wrong threshold here is blocking readers or deindexing the
 * directory. Watch the telemetry first, then flip the mode.
 *
 * Every knob is read from the environment on each call, so an operator can
 * retune from Railway without a deploy. Reading per call rather than at module
 * load is deliberate: the edge runtime keeps isolates alive for a long time, and
 * a value captured at import would need a redeploy to take effect — exactly the
 * property the env-driven design exists to avoid. The cost is a handful of
 * `process.env` reads on a path that is already doing Redis round trips.
 */

export const ENFORCEMENT_ACTIONS = [
  /** Normal traffic. Nothing happens. */
  'allow',
  /** Above the noise floor: recorded and reported, still served. */
  'record',
  /** Send the visitor through Turnstile. */
  'challenge',
  /** 429 for the standard block window. */
  'block',
  /** 429 for the longer block window, after the standard one did not help. */
  'extended_block',
] as const

export type EnforcementAction = (typeof ENFORCEMENT_ACTIONS)[number]

/** Ascending severity. Used to pick the worst tier, never for display. */
const ACTION_SEVERITY: Record<EnforcementAction, number> = {
  allow: 0,
  record: 1,
  challenge: 2,
  block: 3,
  extended_block: 4,
}

/**
 * Machine-readable reason codes. Every decision returned by this module carries
 * exactly one, so a 429 in the wild can always be traced back to the rung and
 * the input that produced it. Values are stable strings: they are emitted as
 * PostHog properties and named in `docs/runbooks/anti-enumeration.md`.
 */
export const ENFORCEMENT_REASONS = {
  BELOW_THRESHOLD: 'below_threshold',
  RECORD_THRESHOLD_EXCEEDED: 'record_threshold_exceeded',
  CHALLENGE_THRESHOLD_EXCEEDED: 'challenge_threshold_exceeded',
  BLOCK_THRESHOLD_EXCEEDED: 'block_threshold_exceeded',
  EXTENDED_BLOCK_THRESHOLD_EXCEEDED: 'extended_block_threshold_exceeded',
  /** A visitor who passed Turnstile and then exhausted the raised budget. */
  VERIFIED_BUDGET_EXHAUSTED: 'verified_budget_exhausted',
  CRAWLER_VERIFIED: 'crawler_verified',
  CRAWLER_TRUSTED_UNVERIFIED: 'crawler_trusted_unverified',
  CRAWLER_UA_UNVERIFIED: 'crawler_ua_unverified',
  NOT_A_CRAWLER: 'not_a_crawler',
} as const

type EnforcementReason =
  (typeof ENFORCEMENT_REASONS)[keyof typeof ENFORCEMENT_REASONS]

export type EnforcementMode = 'observe' | 'enforce'

export interface EnforcementThresholds {
  recordDistinctResources: number
  challengeDistinctResources: number
  blockDistinctResources: number
  extendedBlockDistinctResources: number
  /**
   * How much wider a Turnstile-verified visitor's budget is. FINITE on purpose:
   * before DEV-1551 a `fm_verified` cookie was an unconditional 7-day pass, so
   * one Turnstile solve bought a week of unmetered scraping. Verification now
   * multiplies the budget; it never removes it.
   */
  verifiedBudgetMultiplier: number
  /**
   * How much wider the IP tier is than a cookie tier. TW carrier CGNAT puts
   * thousands of unrelated people behind one egress address, so an IP-tier
   * threshold set at browser scale would block a city.
   */
  ipMultiplier: number
  blockSeconds: number
  extendedBlockSeconds: number
  /** Which traversal window the ladder is evaluated against. */
  window: TraversalWindowName
}

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function envWindow(name: string, fallback: TraversalWindowName): TraversalWindowName {
  const value = process.env[name]?.trim()
  return value && value in TRAVERSAL_WINDOWS ? (value as TraversalWindowName) : fallback
}

/**
 * Log-only unless an operator says otherwise, and only one exact spelling turns
 * it off. `on`, `true` and `1` all mean observe here, because every one of them
 * is a plausible thing to type when trying to enable *reporting* — and a
 * misread there starts refusing real traffic.
 */
export function getEnforcementMode(): EnforcementMode {
  return process.env.ENFORCEMENT_MODE?.trim().toLowerCase() === 'enforce'
    ? 'enforce'
    : 'observe'
}

let inertEnforceModeWarned = false

/**
 * `ENFORCEMENT_MODE=enforce` currently mitigates nothing.
 *
 * This module answers what SHOULD happen; no caller turns the decision into a
 * response yet -- `observeTraversal` reports it and drops it. Setting `enforce`
 * therefore only relabels telemetry (`effectiveAction` stops being `allow` and
 * `shadowed` stops being true), which reads exactly like protection that is
 * switched on. Warn once so an operator cannot believe the ladder is blocking
 * when it is not. No behaviour change: this is the whole fix.
 *
 * Upgrade path: delete this warning in the same change that acts on
 * `decision.effectiveAction` at the proxy.
 */
export function warnIfEnforcementModeIsInert(): void {
  if (inertEnforceModeWarned) return
  if (getEnforcementMode() !== 'enforce') return
  inertEnforceModeWarned = true
  // console.warn rather than the Sentry adapter: this runs in the edge runtime,
  // where the Node SDK is not loaded.
  console.warn(
    JSON.stringify({
      event: 'enforcement_mode_inert',
      reason: 'ENFORCEMENT_MODE=enforce is set, but no caller acts on the decision',
      impact:
        'the ladder still allows every request; the mode only relabels telemetry',
    }),
  )
}

/** Test seam: the warning is once-per-process, so suites must be able to rearm it. */
export function resetEnforcementWarningForTests(): void {
  inertEnforceModeWarned = false
}

/**
 * Defaults are placeholders sized off nothing but judgement — the counters have
 * never run in production (`TRAVERSAL_COUNTERS` is off by default). They are
 * deliberately loose: a reader who opens 40 brand pages in ten minutes is
 * plausible, 320 is not. Calibrate against the recorded distribution before the
 * mode is flipped.
 */
export function getEnforcementThresholds(): EnforcementThresholds {
  return {
    recordDistinctResources: envNumber('ENFORCEMENT_RECORD_DISTINCT', 40),
    challengeDistinctResources: envNumber('ENFORCEMENT_CHALLENGE_DISTINCT', 80),
    blockDistinctResources: envNumber('ENFORCEMENT_BLOCK_DISTINCT', 160),
    extendedBlockDistinctResources: envNumber('ENFORCEMENT_EXTENDED_BLOCK_DISTINCT', 320),
    verifiedBudgetMultiplier: envNumber('ENFORCEMENT_VERIFIED_MULTIPLIER', 4),
    ipMultiplier: envNumber('ENFORCEMENT_IP_MULTIPLIER', identityThresholdMultiplier('ip')),
    blockSeconds: envNumber('ENFORCEMENT_BLOCK_SECONDS', 60),
    extendedBlockSeconds: envNumber('ENFORCEMENT_EXTENDED_BLOCK_SECONDS', 900),
    window: envWindow('ENFORCEMENT_WINDOW', 'tenMinutes'),
  }
}

interface TierObservation {
  kind: TraversalIdentityKind
  distinctResources: number
  logicalViews: number
}

export interface EnforcementDecision {
  /** What the ladder concluded, regardless of mode. */
  action: EnforcementAction
  /** What the request actually experiences. Always `allow` in observe mode. */
  effectiveAction: EnforcementAction
  reason: EnforcementReason
  mode: EnforcementMode
  /** True when the mode suppressed a non-allow action. */
  shadowed: boolean
  family: RouteFamily
  window: TraversalWindowName
  /** The identity tier that produced the decision. */
  identityKind: TraversalIdentityKind
  /** The scaled threshold the observation was compared against. */
  threshold: number
  /** Distinct resources seen for that tier in this window. */
  observed: number
  retryAfterSeconds?: number
}

interface TierVerdict {
  action: EnforcementAction
  threshold: number
}

function scaleFor(
  kind: TraversalIdentityKind,
  verified: boolean,
  thresholds: EnforcementThresholds,
): number {
  const tierScale = kind === 'ip' ? thresholds.ipMultiplier : 1
  const verifiedScale = verified ? thresholds.verifiedBudgetMultiplier : 1
  return tierScale * verifiedScale
}

function verdictFor(
  tier: TierObservation,
  verified: boolean,
  thresholds: EnforcementThresholds,
): TierVerdict {
  const scale = scaleFor(tier.kind, verified, thresholds)
  // Descending, so the first crossed rung is the highest one crossed.
  const rungs: ReadonlyArray<[EnforcementAction, number]> = [
    ['extended_block', thresholds.extendedBlockDistinctResources * scale],
    ['block', thresholds.blockDistinctResources * scale],
    ['challenge', thresholds.challengeDistinctResources * scale],
    ['record', thresholds.recordDistinctResources * scale],
  ]

  for (const [action, threshold] of rungs) {
    if (tier.distinctResources >= threshold) return { action, threshold }
  }

  return { action: 'allow', threshold: thresholds.recordDistinctResources * scale }
}

const THRESHOLD_REASONS: Record<EnforcementAction, EnforcementReason> = {
  allow: ENFORCEMENT_REASONS.BELOW_THRESHOLD,
  record: ENFORCEMENT_REASONS.RECORD_THRESHOLD_EXCEEDED,
  challenge: ENFORCEMENT_REASONS.CHALLENGE_THRESHOLD_EXCEEDED,
  block: ENFORCEMENT_REASONS.BLOCK_THRESHOLD_EXCEEDED,
  extended_block: ENFORCEMENT_REASONS.EXTENDED_BLOCK_THRESHOLD_EXCEEDED,
}

function retryAfterFor(
  action: EnforcementAction,
  thresholds: EnforcementThresholds,
): number | undefined {
  if (action === 'block') return thresholds.blockSeconds
  if (action === 'extended_block') return thresholds.extendedBlockSeconds
  return undefined
}

export interface DecideEnforcementInput {
  tiers: readonly TierObservation[]
  family: RouteFamily
  window: TraversalWindowName
  /** Passed Turnstile within the challenge cookie's lifetime. */
  verified?: boolean
  mode?: EnforcementMode
  thresholds?: EnforcementThresholds
}

/**
 * Evaluates every identity tier and returns the most severe verdict.
 *
 * Taking the maximum across tiers is what makes cookie rotation useless: a
 * fresh `fm_visitor` resets the visitor tier to one resource, but the IP tier
 * keeps its aggregate, so the ladder does not fall back to `allow`. Rotation
 * therefore costs an attacker nothing and buys them nothing.
 */
export function decideEnforcement(input: DecideEnforcementInput): EnforcementDecision {
  const thresholds = input.thresholds ?? getEnforcementThresholds()
  const mode = input.mode ?? getEnforcementMode()
  const verified = input.verified ?? false

  let worst: { tier: TierObservation; verdict: TierVerdict } | null = null
  for (const tier of input.tiers) {
    const verdict = verdictFor(tier, verified, thresholds)
    if (!worst || ACTION_SEVERITY[verdict.action] > ACTION_SEVERITY[worst.verdict.action]) {
      worst = { tier, verdict }
    }
  }

  // No tiers at all (an exempt caller, or accounting that produced nothing) is
  // an allow with an explicit reason, never an undefined one.
  const fallbackTier: TierObservation = { kind: 'ip', distinctResources: 0, logicalViews: 0 }
  const tier = worst?.tier ?? fallbackTier
  const verdict =
    worst?.verdict ??
    ({
      action: 'allow',
      threshold: thresholds.recordDistinctResources,
    } satisfies TierVerdict)

  const action = verdict.action
  const reason: EnforcementReason =
    verified && action !== 'allow'
      ? ENFORCEMENT_REASONS.VERIFIED_BUDGET_EXHAUSTED
      : THRESHOLD_REASONS[action]

  const effectiveAction: EnforcementAction = mode === 'enforce' ? action : 'allow'

  return {
    action,
    effectiveAction,
    reason,
    mode,
    shadowed: mode !== 'enforce' && action !== 'allow',
    family: input.family,
    window: input.window,
    identityKind: tier.kind,
    threshold: verdict.threshold,
    observed: tier.distinctResources,
    ...(effectiveAction === action ? { retryAfterSeconds: retryAfterFor(action, thresholds) } : {}),
  }
}

type CrawlerExemptionReason =
  | typeof ENFORCEMENT_REASONS.CRAWLER_VERIFIED
  | typeof ENFORCEMENT_REASONS.CRAWLER_TRUSTED_UNVERIFIED
  | typeof ENFORCEMENT_REASONS.CRAWLER_UA_UNVERIFIED
  | typeof ENFORCEMENT_REASONS.NOT_A_CRAWLER

export interface CrawlerExemptionDecision {
  exempt: boolean
  reason: CrawlerExemptionReason
}

interface CrawlerSignals {
  /** The User-Agent matches an entry in `crawler-registry.ts`. */
  claimsCrawler: boolean
  /** Cloudflare stamped the verified-bot header on this request. */
  verified: boolean
  /** The matched registry entry is one we trust without verification. */
  trustedUnverified: boolean
}

/**
 * Who the LADDER exempts. A User-Agent alone no longer qualifies: `Googlebot`
 * is four characters of an attacker's choosing, and before this the string
 * bought a full bypass of both the limiter and the soft challenge.
 *
 * Deliberately NOT the same predicate as the hard limiter's exemption in
 * `rate-limiter.ts`. That one is interlocked on having observed the Cloudflare
 * verified-bot header at least once (see `verified-crawler.ts`) and must stay
 * UA-based until the transform rule ships, or a premature flip 429s Googlebot
 * and deindexes the directory. The ladder can be strict today because it
 * defaults to observe: a wrong answer here costs a telemetry event, not a
 * search ranking.
 *
 * Ceiling: two exemption predicates coexist until the transform rule is live.
 * Upgrade path: once `hasObservedVerifiedHeader()` is true in production and
 * `VERIFIED_CRAWLER_SHADOW=off` has soaked, delete the limiter's UA branch and
 * have it call this function instead.
 */
export function resolveCrawlerExemption(input: {
  userAgentClaimsCrawler: boolean
  verified: boolean
  trustedUnverified: boolean
}): CrawlerExemptionDecision {
  if (input.verified) {
    return { exempt: true, reason: ENFORCEMENT_REASONS.CRAWLER_VERIFIED }
  }
  if (input.trustedUnverified) {
    return { exempt: true, reason: ENFORCEMENT_REASONS.CRAWLER_TRUSTED_UNVERIFIED }
  }
  if (input.userAgentClaimsCrawler) {
    return { exempt: false, reason: ENFORCEMENT_REASONS.CRAWLER_UA_UNVERIFIED }
  }
  return { exempt: false, reason: ENFORCEMENT_REASONS.NOT_A_CRAWLER }
}

export interface EvaluateTraversalInput {
  store: TraversalStore
  userId?: string | null
  visitorId?: string | null
  ip: string
  pathname: string
  searchParams?: URLSearchParams | string
  /** Passed Turnstile within the challenge cookie's lifetime. */
  verified?: boolean
  crawler?: CrawlerSignals
  now?: number
  mode?: EnforcementMode
  thresholds?: EnforcementThresholds
}

export interface EvaluateTraversalResult {
  decision: EnforcementDecision
  tiers: readonly TierObservation[]
  snapshots: readonly TraversalSnapshot[]
  exempt: boolean
}

/**
 * Records this request against every identity tier that applies and runs the
 * ladder over the result.
 *
 * TWO tiers are recorded when a cookie identity exists: the cookie tier and the
 * IP tier. That is the mechanism behind rotation resistance — without the
 * second write, deleting `fm_visitor` would erase the only counter that had
 * seen the traversal. It costs a second set of store round trips per request,
 * which is affordable only because the whole path is behind
 * `TRAVERSAL_COUNTERS` and off by default.
 */
export async function evaluateTraversal(
  input: EvaluateTraversalInput,
): Promise<EvaluateTraversalResult> {
  const thresholds = input.thresholds ?? getEnforcementThresholds()
  const mode = input.mode ?? getEnforcementMode()

  if (input.crawler) {
    const exemption = resolveCrawlerExemption({
      userAgentClaimsCrawler: input.crawler.claimsCrawler,
      verified: input.crawler.verified,
      trustedUnverified: input.crawler.trustedUnverified,
    })
    if (exemption.exempt) {
      return {
        exempt: true,
        tiers: [],
        snapshots: [],
        decision: {
          action: 'allow',
          effectiveAction: 'allow',
          reason: exemption.reason,
          mode,
          shadowed: false,
          family: classifyRoute(input.pathname, input.searchParams).family,
          window: thresholds.window,
          identityKind: 'ip',
          threshold: thresholds.recordDistinctResources,
          observed: 0,
        },
      }
    }
  }

  const primary = resolveTraversalIdentity({
    userId: input.userId ?? null,
    visitorId: input.visitorId ?? null,
    ip: input.ip,
  })
  const identities = [primary]
  if (primary.kind !== 'ip') {
    identities.push(resolveTraversalIdentity({ userId: null, visitorId: null, ip: input.ip }))
  }

  const snapshots: TraversalSnapshot[] = []
  for (const identity of identities) {
    snapshots.push(
      await recordTraversalView({
        store: input.store,
        identity,
        pathname: input.pathname,
        searchParams: input.searchParams,
        now: input.now,
      }),
    )
  }

  const tiers: TierObservation[] = snapshots.map((snapshot) => ({
    kind: snapshot.identity.kind,
    distinctResources: snapshot.distinctResources[thresholds.window],
    logicalViews: snapshot.logicalViews[thresholds.window],
  }))

  const family = snapshots.at(0)?.family ?? 'public:global-content'

  return {
    exempt: false,
    tiers,
    snapshots,
    decision: decideEnforcement({
      tiers,
      family,
      window: thresholds.window,
      verified: input.verified,
      mode,
      thresholds,
    }),
  }
}

// One warning at module scope, mirroring `warnIfOriginGuardDisabled`. The
// condition is permanent for the life of the isolate.
warnIfEnforcementModeIsInert()
