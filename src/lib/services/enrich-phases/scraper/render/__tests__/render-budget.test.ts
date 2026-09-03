import { describe, it, expect } from 'vitest'
import type { RenderProvider, RenderResult } from '../types'

function makeMockProvider(delay = 0): RenderProvider & { readonly inFlight: number; readonly maxInFlight: number; readonly callCount: number } {
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
      monthly: { threshold: 10000, loadCount: async () => 0 },
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
      monthly: { threshold: 10000, loadCount: async () => 0 },
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
    // The worker builds ONE provider for its whole life, so `brandKey` is the
    // placeholder every brand would otherwise share — the shape that turned a
    // per-brand cap of 3 into a per-process cap of 3.
    const budgeted = withRenderBudget(inner, {
      brandKey: () => 'unknown',
      perBrand: 3,
      perJob: 1000,
      monthly: { threshold: 10000, loadCount: async () => 0 },
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

  it('monthly gauge refuses at threshold and allows below', async () => {
    const inner = makeMockProvider()

    const { withRenderBudget, RenderBudgetExceeded } = await import('../render-budget')

    // At 900 (= threshold) → refuse
    const budgetedHigh = withRenderBudget(inner, {
      brandKey: () => 'brand-y',
      perBrand: 100,
      perJob: 1000,
      monthly: { threshold: 900, loadCount: async () => 900 },
    })
    await expect(budgetedHigh.fetchRendered('https://b.com')).rejects.toThrow(RenderBudgetExceeded)

    // At 899 (< threshold) → allow and increment
    const innerOk = makeMockProvider()
    const budgetedOk = withRenderBudget(innerOk, {
      brandKey: () => 'brand-z',
      perBrand: 100,
      perJob: 1000,
      monthly: { threshold: 900, loadCount: async () => 899 },
    })
    const result = await budgetedOk.fetchRendered('https://c.com')
    expect(result.html).toContain('c.com')
    expect(innerOk.callCount).toBe(1)
  })
})
