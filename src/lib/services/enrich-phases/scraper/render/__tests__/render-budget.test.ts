import { describe, it, expect } from 'vitest'
import type { RenderProvider, RenderResult } from '../types'

function makeMockProvider(delay = 0): RenderProvider & { readonly inFlight: number; readonly maxInFlight: number; readonly callCount: number; close?(): Promise<void> } {
  const tracker = { inFlight: 0, maxInFlight: 0, callCount: 0 }
  return {
    get inFlight() { return tracker.inFlight },
    get maxInFlight() { return tracker.maxInFlight },
    get callCount() { return tracker.callCount },
    async fetchRendered(url: string): Promise<RenderResult> {
      tracker.callCount++
      tracker.inFlight++
      if (tracker.inFlight > tracker.maxInFlight) tracker.maxInFlight = tracker.inFlight
      if (delay > 0) await new Promise((r) => setTimeout(r, delay))
      tracker.inFlight--
      return { html: `<html>${url}</html>`, finalUrl: url, status: 200 }
    },
  }
}

describe('withRenderBudget', () => {
  it('semaphore limits concurrency to two', async () => {
    const inner = makeMockProvider(50)

    const { withRenderBudget } = await import('../render-budget')
    const budgeted = withRenderBudget(inner, {
      brandKey: () => 'brand-a',
      perBrand: 100,
      perJob: 1000,
    })

    const promises = Array.from({ length: 5 }, (_, i) =>
      budgeted.fetchRendered(`https://example.com/${i}`),
    )
    await Promise.all(promises)

    expect(inner.maxInFlight).toBeLessThanOrEqual(2)
    expect(inner.callCount).toBe(5)
  })

  it('per-brand cap refuses the fourth render', async () => {
    const inner = makeMockProvider()

    const { withRenderBudget, RenderBudgetExceeded } = await import('../render-budget')
    const budgeted = withRenderBudget(inner, {
      brandKey: () => 'brand-x',
      perBrand: 3,
      perJob: 1000,
    })

    await budgeted.fetchRendered('https://a.com/1')
    await budgeted.fetchRendered('https://a.com/2')
    await budgeted.fetchRendered('https://a.com/3')

    await expect(budgeted.fetchRendered('https://a.com/4')).rejects.toThrow(RenderBudgetExceeded)
    // Inner should have been called only 3 times
    expect(inner.callCount).toBe(3)
  })

  it('per-brand cap is per brand, not per worker process', async () => {
    const inner = makeMockProvider()

    const { withRenderBudget, bindBrandKey } = await import('../render-budget')
    const budgeted = withRenderBudget(inner, {
      brandKey: () => 'unknown',
      perBrand: 3,
      perJob: 1000,
    })

    const forBrandA = bindBrandKey(budgeted, 'brand-a')
    await forBrandA.fetchRendered('https://a.com/1')
    await forBrandA.fetchRendered('https://a.com/2')
    await forBrandA.fetchRendered('https://a.com/3')

    const forBrandB = bindBrandKey(budgeted, 'brand-b')
    const result = await forBrandB.fetchRendered('https://b.com/1')

    expect(result.html).toContain('b.com')
    expect(inner.callCount).toBe(4)
  })

  it('per_job_cap_refuses_the_151st_render', async () => {
    const inner = makeMockProvider()

    const { withRenderBudget, RenderBudgetExceeded } = await import('../render-budget')
    const budgeted = withRenderBudget(inner, {
      brandKey: () => 'unknown',
      perBrand: 1000, // high enough to never hit
      perJob: 150,
    })

    // 150 renders across many brand keys succeed
    for (let i = 0; i < 150; i++) {
      await budgeted.fetchRendered(`https://example.com/${i}`, `brand-${i}`)
    }
    expect(inner.callCount).toBe(150)

    // The 151st throws
    const err = await budgeted.fetchRendered('https://example.com/151', 'brand-151').catch((e) => e)
    expect(err).toBeInstanceOf(RenderBudgetExceeded)
    expect((err as InstanceType<typeof RenderBudgetExceeded>).scope).toBe('job')
    expect(inner.callCount).toBe(150)
  })

  it('close_passes_through_to_inner', async () => {
    let closeCalled = 0
    const innerWithClose: RenderProvider = {
      async fetchRendered(url: string): Promise<RenderResult> {
        return { html: `<html>${url}</html>`, finalUrl: url, status: 200 }
      },
      async close() {
        closeCalled++
      },
    }

    const { withRenderBudget } = await import('../render-budget')
    const wrapped = withRenderBudget(innerWithClose, {
      brandKey: () => 'x',
      perBrand: 10,
      perJob: 100,
    })

    await wrapped.close()
    expect(closeCalled).toBe(1)
  })

  it('close resolves when inner has no close', async () => {
    const innerNoClose: RenderProvider = {
      async fetchRendered(url: string): Promise<RenderResult> {
        return { html: `<html>${url}</html>`, finalUrl: url, status: 200 }
      },
    }

    const { withRenderBudget } = await import('../render-budget')
    const wrapped = withRenderBudget(innerNoClose, {
      brandKey: () => 'x',
      perBrand: 10,
      perJob: 100,
    })

    // Should not throw
    await expect(wrapped.close()).resolves.toBeUndefined()
  })
})
