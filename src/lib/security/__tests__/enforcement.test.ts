import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  decideEnforcement,
  ENFORCEMENT_ACTIONS,
  ENFORCEMENT_REASONS,
  evaluateTraversal,
  getEnforcementMode,
  getEnforcementThresholds,
  resolveCrawlerExemption,
  type EnforcementAction,
  type EnforcementThresholds,
} from '../enforcement'
import {
  createInMemoryTraversalStore,
  type TraversalStore,
} from '../traversal-counters'

/**
 * Small thresholds so a test can walk the whole ladder in a handful of steps.
 * `ipMultiplier: 1` collapses the CGNAT allowance that production needs (20x)
 * but a unit test cannot afford to loop through.
 */
const THRESHOLDS: EnforcementThresholds = {
  recordDistinctResources: 2,
  challengeDistinctResources: 3,
  blockDistinctResources: 4,
  extendedBlockDistinctResources: 5,
  verifiedBudgetMultiplier: 3,
  ipMultiplier: 1,
  blockSeconds: 60,
  extendedBlockSeconds: 900,
  window: 'tenMinutes',
}

function decideAt(distinctResources: number, overrides: { verified?: boolean } = {}) {
  return decideEnforcement({
    tiers: [{ kind: 'visitor', distinctResources, logicalViews: distinctResources }],
    family: 'directory:detail',
    window: 'tenMinutes',
    mode: 'enforce',
    verified: overrides.verified ?? false,
    thresholds: THRESHOLDS,
  })
}

describe('enforcement ladder', () => {
  it('escalates normal -> record -> challenge -> 429 -> longer block', () => {
    const steps: Array<{ observed: number; action: EnforcementAction; reason: string }> = [
      { observed: 1, action: 'allow', reason: ENFORCEMENT_REASONS.BELOW_THRESHOLD },
      { observed: 2, action: 'record', reason: ENFORCEMENT_REASONS.RECORD_THRESHOLD_EXCEEDED },
      {
        observed: 3,
        action: 'challenge',
        reason: ENFORCEMENT_REASONS.CHALLENGE_THRESHOLD_EXCEEDED,
      },
      { observed: 4, action: 'block', reason: ENFORCEMENT_REASONS.BLOCK_THRESHOLD_EXCEEDED },
      {
        observed: 5,
        action: 'extended_block',
        reason: ENFORCEMENT_REASONS.EXTENDED_BLOCK_THRESHOLD_EXCEEDED,
      },
    ]

    for (const step of steps) {
      const decision = decideAt(step.observed)
      expect(decision.action).toBe(step.action)
      expect(decision.reason).toBe(step.reason)
    }
  })

  it('carries the retry window only on the two blocking rungs', () => {
    expect(decideAt(3).retryAfterSeconds).toBeUndefined()
    expect(decideAt(4).retryAfterSeconds).toBe(THRESHOLDS.blockSeconds)
    // The "longer block" rung is longer, not merely a repeat of the 429.
    expect(decideAt(5).retryAfterSeconds).toBe(THRESHOLDS.extendedBlockSeconds)
    expect(THRESHOLDS.extendedBlockSeconds).toBeGreaterThan(THRESHOLDS.blockSeconds)
  })

  it('every action carries a machine-readable reason code', () => {
    const known = new Set<string>(Object.values(ENFORCEMENT_REASONS))
    const seen = new Set<EnforcementAction>()

    for (let observed = 0; observed <= 12; observed += 1) {
      for (const verified of [false, true]) {
        const decision = decideAt(observed, { verified })
        expect(known.has(decision.reason)).toBe(true)
        expect(decision.reason).not.toBe('')
        seen.add(decision.action)
      }
    }

    // Not a tautology: the loop above must actually reach every rung, or the
    // reason-code assertion would only cover `allow`.
    for (const action of ENFORCEMENT_ACTIONS) expect(seen.has(action)).toBe(true)
  })

  it('verification grants a finite raised budget', () => {
    // At a count that blocks an unverified visitor, a verified one passes...
    expect(decideAt(4).action).toBe('block')
    expect(decideAt(4, { verified: true }).action).toBe('allow')

    // ...but the raised budget is a multiple, not an exemption. Past
    // `blockDistinctResources * verifiedBudgetMultiplier` the verified visitor
    // is blocked too, with a reason code that says why.
    const exhausted = decideAt(4 * THRESHOLDS.verifiedBudgetMultiplier, { verified: true })
    expect(exhausted.action).toBe('block')
    expect(exhausted.reason).toBe(ENFORCEMENT_REASONS.VERIFIED_BUDGET_EXHAUSTED)

    // And the ceiling still exists above that: no count makes a verified
    // visitor unlimited.
    expect(decideAt(10_000, { verified: true }).action).toBe('extended_block')
  })

  it('takes the highest-severity tier, so a quiet visitor behind a hot IP still escalates', () => {
    const decision = decideEnforcement({
      tiers: [
        { kind: 'visitor', distinctResources: 1, logicalViews: 1 },
        { kind: 'ip', distinctResources: 9, logicalViews: 9 },
      ],
      family: 'directory:detail',
      window: 'tenMinutes',
      mode: 'enforce',
      thresholds: THRESHOLDS,
    })

    expect(decision.action).toBe('extended_block')
    expect(decision.identityKind).toBe('ip')
  })

  it('defaults to observe, which reports without acting', () => {
    const decision = decideEnforcement({
      tiers: [{ kind: 'visitor', distinctResources: 9, logicalViews: 9 }],
      family: 'directory:detail',
      window: 'tenMinutes',
      thresholds: THRESHOLDS,
    })

    expect(decision.mode).toBe('observe')
    expect(decision.action).toBe('extended_block')
    // What the request actually experiences.
    expect(decision.effectiveAction).toBe('allow')
    expect(decision.shadowed).toBe(true)
    expect(decision.reason).toBe(ENFORCEMENT_REASONS.EXTENDED_BLOCK_THRESHOLD_EXCEEDED)
  })
})

describe('enforcement configuration', () => {
  const KEYS = [
    'ENFORCEMENT_MODE',
    'ENFORCEMENT_WINDOW',
    'ENFORCEMENT_RECORD_DISTINCT',
    'ENFORCEMENT_CHALLENGE_DISTINCT',
    'ENFORCEMENT_BLOCK_DISTINCT',
    'ENFORCEMENT_EXTENDED_BLOCK_DISTINCT',
    'ENFORCEMENT_VERIFIED_MULTIPLIER',
    'ENFORCEMENT_IP_MULTIPLIER',
    'ENFORCEMENT_BLOCK_SECONDS',
    'ENFORCEMENT_EXTENDED_BLOCK_SECONDS',
  ] as const

  afterEach(() => vi.unstubAllEnvs())

  it('defaults to log-only observe mode', () => {
    for (const key of KEYS) vi.stubEnv(key, '')
    expect(getEnforcementMode()).toBe('observe')
  })

  it('only an explicit enforce value leaves observe mode', () => {
    for (const value of ['', 'observe', 'log', 'on', 'true', 'yes']) {
      vi.stubEnv('ENFORCEMENT_MODE', value)
      expect(getEnforcementMode()).toBe('observe')
    }
    vi.stubEnv('ENFORCEMENT_MODE', 'enforce')
    expect(getEnforcementMode()).toBe('enforce')
    vi.stubEnv('ENFORCEMENT_MODE', ' ENFORCE ')
    expect(getEnforcementMode()).toBe('enforce')
  })

  it('reads every threshold from the environment', () => {
    vi.stubEnv('ENFORCEMENT_RECORD_DISTINCT', '11')
    vi.stubEnv('ENFORCEMENT_CHALLENGE_DISTINCT', '22')
    vi.stubEnv('ENFORCEMENT_BLOCK_DISTINCT', '33')
    vi.stubEnv('ENFORCEMENT_EXTENDED_BLOCK_DISTINCT', '44')
    vi.stubEnv('ENFORCEMENT_VERIFIED_MULTIPLIER', '5')
    vi.stubEnv('ENFORCEMENT_IP_MULTIPLIER', '6')
    vi.stubEnv('ENFORCEMENT_BLOCK_SECONDS', '77')
    vi.stubEnv('ENFORCEMENT_EXTENDED_BLOCK_SECONDS', '888')
    vi.stubEnv('ENFORCEMENT_WINDOW', 'hour')

    expect(getEnforcementThresholds()).toEqual({
      recordDistinctResources: 11,
      challengeDistinctResources: 22,
      blockDistinctResources: 33,
      extendedBlockDistinctResources: 44,
      verifiedBudgetMultiplier: 5,
      ipMultiplier: 6,
      blockSeconds: 77,
      extendedBlockSeconds: 888,
      window: 'hour',
    })
  })

  it('ignores an unusable value rather than disabling the rung', () => {
    vi.stubEnv('ENFORCEMENT_BLOCK_DISTINCT', 'not-a-number')
    vi.stubEnv('ENFORCEMENT_WINDOW', 'fortnight')
    const thresholds = getEnforcementThresholds()

    expect(thresholds.blockDistinctResources).toBeGreaterThan(0)
    expect(thresholds.window).toBe('tenMinutes')
  })
})

describe('crawler exemption', () => {
  it('a spoofed crawler UA no longer exempts', () => {
    const spoofed = resolveCrawlerExemption({
      userAgentClaimsCrawler: true,
      verified: false,
      trustedUnverified: false,
    })

    expect(spoofed.exempt).toBe(false)
    expect(spoofed.reason).toBe(ENFORCEMENT_REASONS.CRAWLER_UA_UNVERIFIED)
  })

  it('the verified-bot header is what buys the exemption', () => {
    const verified = resolveCrawlerExemption({
      userAgentClaimsCrawler: true,
      verified: true,
      trustedUnverified: false,
    })

    expect(verified.exempt).toBe(true)
    expect(verified.reason).toBe(ENFORCEMENT_REASONS.CRAWLER_VERIFIED)
  })

  it('keeps the trustedUnverified registry carve-out', () => {
    const trusted = resolveCrawlerExemption({
      userAgentClaimsCrawler: true,
      verified: false,
      trustedUnverified: true,
    })

    expect(trusted.exempt).toBe(true)
    expect(trusted.reason).toBe(ENFORCEMENT_REASONS.CRAWLER_TRUSTED_UNVERIFIED)
  })

  it('an ordinary browser is not a crawler and is never exempt', () => {
    const browser = resolveCrawlerExemption({
      userAgentClaimsCrawler: false,
      verified: false,
      trustedUnverified: false,
    })

    expect(browser.exempt).toBe(false)
    expect(browser.reason).toBe(ENFORCEMENT_REASONS.NOT_A_CRAWLER)
  })
})

describe('evaluateTraversal', () => {
  let store: TraversalStore

  beforeEach(() => {
    store = createInMemoryTraversalStore()
  })

  async function sweep(input: {
    visitorId: string | null
    ip: string
    slugs: readonly string[]
    verified?: boolean
  }) {
    let last = null as Awaited<ReturnType<typeof evaluateTraversal>> | null
    for (const slug of input.slugs) {
      last = await evaluateTraversal({
        store,
        visitorId: input.visitorId,
        ip: input.ip,
        pathname: `/brands/${slug}`,
        verified: input.verified ?? false,
        mode: 'enforce',
        thresholds: THRESHOLDS,
      })
    }
    if (!last) throw new Error('expected at least one evaluation')
    return last
  }

  it('cookie rotation does not reset IP-level state', async () => {
    const slugs = ['aaa', 'bbb', 'ccc', 'ddd', 'eee']
    const before = await sweep({ visitorId: 'visitor-one', ip: '198.51.100.9', slugs })
    expect(before.decision.action).toBe('extended_block')

    // A brand new cookie. The visitor tier is genuinely fresh...
    const after = await sweep({
      visitorId: 'visitor-two',
      ip: '198.51.100.9',
      slugs: ['fff'],
    })
    const visitorTier = after.tiers.find((tier) => tier.kind === 'visitor')
    expect(visitorTier?.distinctResources).toBe(1)

    // ...and the aggregate the IP carries is inherited, so the ladder does not
    // drop back to `allow`.
    const ipTier = after.tiers.find((tier) => tier.kind === 'ip')
    expect(ipTier?.distinctResources).toBe(6)
    expect(after.decision.action).toBe('extended_block')
    expect(after.decision.identityKind).toBe('ip')
  })

  it('a Googlebot UA without the verified-bot header is metered', async () => {
    const metered = await evaluateTraversal({
      store,
      visitorId: null,
      ip: '198.51.100.10',
      pathname: '/brands/talkoo',
      crawler: { claimsCrawler: true, verified: false, trustedUnverified: false },
      mode: 'enforce',
      thresholds: THRESHOLDS,
    })

    expect(metered.exempt).toBe(false)
    expect(metered.tiers.some((tier) => tier.distinctResources === 1)).toBe(true)
    expect(metered.decision.reason).not.toBe(ENFORCEMENT_REASONS.CRAWLER_VERIFIED)
  })

  it('a verified crawler is exempt and costs no counter writes', async () => {
    const exempted = await evaluateTraversal({
      store,
      visitorId: null,
      ip: '198.51.100.11',
      pathname: '/brands/talkoo',
      crawler: { claimsCrawler: true, verified: true, trustedUnverified: false },
      mode: 'enforce',
      thresholds: THRESHOLDS,
    })

    expect(exempted.exempt).toBe(true)
    expect(exempted.decision.action).toBe('allow')
    expect(exempted.decision.reason).toBe(ENFORCEMENT_REASONS.CRAWLER_VERIFIED)
    expect(exempted.tiers).toHaveLength(0)
  })
})
