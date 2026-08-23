import { describe, expect, it } from 'vitest'

import {
  TRAVERSAL_WINDOWS,
  createInMemoryTraversalStore,
  recordTraversalView,
  resolveTraversalIdentity,
} from '../traversal-counters'

const IDENTITY = resolveTraversalIdentity({
  userId: null,
  visitorId: 'c1a1f7a2-0d1e-4b3c-8a9d-1f2e3d4c5b6a',
  ip: '203.0.113.7',
})

describe('traversal counters', () => {
  it('resolves identity as user, then visitor, then ip', () => {
    expect(
      resolveTraversalIdentity({ userId: 'u1', visitorId: 'v1', ip: '1.1.1.1' }).kind,
    ).toBe('user')
    expect(
      resolveTraversalIdentity({ userId: null, visitorId: 'v1', ip: '1.1.1.1' }).kind,
    ).toBe('visitor')
    expect(
      resolveTraversalIdentity({ userId: null, visitorId: null, ip: '1.1.1.1' }).kind,
    ).toBe('ip')
  })

  it('deduplicates document and RSC requests for one resource', async () => {
    const store = createInMemoryTraversalStore()
    const now = 1_700_000_000_000

    const document = await recordTraversalView({
      store,
      identity: IDENTITY,
      pathname: '/brands/mizu-tw',
      now,
    })
    const rsc = await recordTraversalView({
      store,
      identity: IDENTITY,
      pathname: '/zh-TW/brands/mizu-tw',
      now: now + 40,
    })

    expect(document.deduplicated).toBe(false)
    expect(rsc.deduplicated).toBe(true)
    expect(rsc.logicalViews.hour).toBe(1)
    expect(rsc.distinctResources.hour).toBe(1)
  })

  it('counts 100 distinct slugs as 100 resources', async () => {
    const store = createInMemoryTraversalStore()
    const now = 1_700_000_000_000
    let snapshot = null as Awaited<ReturnType<typeof recordTraversalView>> | null

    for (let index = 0; index < 100; index += 1) {
      snapshot = await recordTraversalView({
        store,
        identity: IDENTITY,
        pathname: `/brands/brand-${index}`,
        now: now + index,
      })
      // Its RSC twin: dedup must collapse the view, never the resource.
      await recordTraversalView({
        store,
        identity: IDENTITY,
        pathname: `/brands/brand-${index}`,
        now: now + index,
      })
    }

    expect(snapshot?.distinctResources.hour).toBe(100)
    expect(snapshot?.logicalViews.hour).toBe(100)
  })

  it('image requests do not consume the detail budget', async () => {
    const store = createInMemoryTraversalStore()
    const now = 1_700_000_000_000

    await recordTraversalView({
      store,
      identity: IDENTITY,
      pathname: '/i/abcdef/cover.webp',
      now,
    })
    const detail = await recordTraversalView({
      store,
      identity: IDENTITY,
      pathname: '/brands/mizu-tw',
      now: now + 1,
    })

    expect(detail.family).toBe('directory:detail')
    expect(detail.logicalViews.hour).toBe(1)
  })

  it('counters span burst, 10-minute and hourly windows', async () => {
    const store = createInMemoryTraversalStore()
    const now = 1_700_000_000_000

    await recordTraversalView({
      store,
      identity: IDENTITY,
      pathname: '/brands/alpha-brand',
      now,
    })
    const second = await recordTraversalView({
      store,
      identity: IDENTITY,
      pathname: '/brands/beta-brand',
      now: now + 1_000,
    })

    expect(second.logicalViews.burst).toBe(2)
    expect(second.logicalViews.tenMinutes).toBe(2)
    expect(second.logicalViews.hour).toBe(2)

    // Past the burst window, inside the other two: burst restarts while the
    // longer windows keep accumulating.
    const later = await recordTraversalView({
      store,
      identity: IDENTITY,
      pathname: '/brands/gamma-brand',
      now: now + TRAVERSAL_WINDOWS.burst + 1_000,
    })

    expect(later.logicalViews.burst).toBe(1)
    expect(later.logicalViews.tenMinutes).toBe(3)
    expect(later.logicalViews.hour).toBe(3)
    expect(later.distinctResources.hour).toBe(3)

    // Past the 10-minute window, inside the hour.
    const muchLater = await recordTraversalView({
      store,
      identity: IDENTITY,
      pathname: '/brands/delta-brand',
      now: now + TRAVERSAL_WINDOWS.tenMinutes + 1_000,
    })

    expect(muchLater.logicalViews.burst).toBe(1)
    expect(muchLater.logicalViews.tenMinutes).toBe(1)
    expect(muchLater.logicalViews.hour).toBe(4)
  })

  it('keeps route families in separate buckets', async () => {
    const store = createInMemoryTraversalStore()
    const now = 1_700_000_000_000

    await recordTraversalView({
      store,
      identity: IDENTITY,
      pathname: '/brands/alpha-brand',
      now,
    })
    const list = await recordTraversalView({
      store,
      identity: IDENTITY,
      pathname: '/brands',
      now: now + 1,
    })

    expect(list.family).toBe('directory:list')
    expect(list.logicalViews.hour).toBe(1)
  })
})
