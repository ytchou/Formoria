import type { RenderProvider, RenderResult } from './types'

export class RenderBudgetExceeded extends Error {
  constructor(public readonly scope: 'brand' | 'job' | 'monthly') {
    super(`Render budget exceeded (${scope})`)
    this.name = 'RenderBudgetExceeded'
  }
}

interface RenderBudgetOptions {
  brandKey: () => string
  perBrand: number
  perJob: number
  monthly: {
    threshold: number
    loadCount: () => Promise<number>
  }
}

const MAX_CONCURRENCY = 2

/**
 * Wraps a RenderProvider with concurrency limiting and budget enforcement.
 *
 * - 2-slot semaphore limits in-flight renders.
 * - Per-brand cap prevents a single brand from consuming the entire budget.
 * - Per-job cap prevents a single job from consuming the entire budget.
 * - Monthly gauge loaded once and incremented locally; refuses at threshold.
 */
export function withRenderBudget(
  inner: RenderProvider,
  opts: RenderBudgetOptions,
): RenderProvider {
  const brandCounts = new Map<string, number>()
  let jobCount = 0

  // Monthly gauge: loaded lazily once, then tracked in-memory.
  let monthlyGauge: number | null = null
  let monthlyLoading: Promise<number> | null = null

  async function getMonthlyGauge(): Promise<number> {
    if (monthlyGauge !== null) return monthlyGauge
    if (!monthlyLoading) {
      monthlyLoading = opts.monthly.loadCount()
    }
    monthlyGauge = await monthlyLoading
    return monthlyGauge
  }

  // Simple semaphore
  let running = 0
  const waiting: Array<() => void> = []

  function acquire(): Promise<void> {
    if (running < MAX_CONCURRENCY) {
      running++
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      waiting.push(resolve)
    })
  }

  function release(): void {
    const next = waiting.shift()
    if (next) {
      next()
    } else {
      running--
    }
  }

  async function guardedFetchRendered(url: string): Promise<RenderResult> {
    // Check per-brand cap
    const brand = opts.brandKey()
    const brandCount = brandCounts.get(brand) ?? 0
    if (brandCount >= opts.perBrand) {
      throw new RenderBudgetExceeded('brand')
    }

    // Check per-job cap
    if (jobCount >= opts.perJob) {
      throw new RenderBudgetExceeded('job')
    }

    // Check monthly gauge
    const gauge = await getMonthlyGauge()
    if (gauge >= opts.monthly.threshold) {
      throw new RenderBudgetExceeded('monthly')
    }

    await acquire()
    try {
      const result = await inner.fetchRendered(url)
      // Increment counters on success
      brandCounts.set(brand, brandCount + 1)
      jobCount++
      monthlyGauge = (monthlyGauge ?? gauge) + 1
      return result
    } finally {
      release()
    }
  }

  return {
    fetchRendered: guardedFetchRendered,
    async fetchRenderedBatch(urls: readonly string[]): Promise<Array<RenderResult | null>> {
      return Promise.all(
        urls.map(async (url) => {
          try {
            return await guardedFetchRendered(url)
          } catch {
            return null
          }
        }),
      )
    },
  }
}
