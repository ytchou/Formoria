import { describe, it, expect, vi } from 'vitest'
import { BLOCK_ORDER, type BlockName } from '@/lib/constants/enrich-phases'
import type { EnrichPhaseName } from '@/lib/constants/enrich-phases'
import type { Block, BrandBlock, BlockContext } from '../registry'
import { buildBlockRegistry } from '../registry'
import { runBlocks } from '../runner'
import type { RunBlocksHooks } from '../runner'
import type { PhaseOutputStore } from '../phase-outputs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type CallRecord = { block: string; brandId: string }

function makeCtx(brandId: string): BlockContext {
  return {
    brandId,
    targetId: `target-${brandId}`,
    targetType: 'brand',
    state: {},
  }
}

function fakeBlock(
  name: string,
  scope: 'chunk' | 'brand',
  phases: readonly EnrichPhaseName[],
  calls: CallRecord[],
  overrides?: Partial<BrandBlock>,
): Block {
  const defaultRun: BrandBlock['run'] = async (ctx) => {
    calls.push({ block: name, brandId: ctx.brandId })
    return { output: { patch: {} } }
  }
  const conditions = {
    phases,
    precondition: overrides?.precondition,
    postcondition: overrides?.postcondition,
  }
  if (scope === 'chunk') {
    return {
      ...conditions,
      scope,
      async runBatch(contexts) {
        calls.push({
          block: name,
          brandId: contexts.map((ctx) => ctx.brandId).join(','),
        })
        return new Map(
          contexts.map((ctx) => [ctx.targetId, { output: { patch: {} } }]),
        )
      },
    }
  }
  return { ...conditions, scope, run: overrides?.run ?? defaultRun }
}

function fakeStore(
  readerOverrides?: Partial<PhaseOutputStore['reader']>,
): PhaseOutputStore & { upserted: Record<string, unknown>[] } {
  const upserted: Record<string, unknown>[] = []
  return {
    upserted,
    reader: {
      latestPerPhase:
        readerOverrides?.latestPerPhase ?? vi.fn().mockResolvedValue([]),
      unpersisted:
        readerOverrides?.unpersisted ?? vi.fn().mockResolvedValue([]),
    },
    writer: {
      upsert: vi
        .fn()
        .mockImplementation(async (rows: Record<string, unknown>[]) => {
          upserted.push(...rows)
        }),
      markPersisted: vi.fn().mockResolvedValue(undefined),
    },
  }
}

function emptyMaps() {
  return {
    satisfaction: new Map<string, Map<string, Date>>(),
    force: new Map<string, Set<string>>(),
  }
}

function buildTestRegistry(
  calls: CallRecord[],
  overrides?: Partial<Record<BlockName, Partial<BrandBlock>>>,
): Record<BlockName, Block> {
  return {
    gather: fakeBlock('gather', 'chunk', [], calls, overrides?.gather),
    detect: fakeBlock(
      'detect',
      'chunk',
      ['detect', 'slugs'] as const,
      calls,
      overrides?.detect,
    ),
    acquire: fakeBlock(
      'acquire',
      'brand',
      ['acquire'] as const,
      calls,
      overrides?.acquire,
    ),
    names: fakeBlock(
      'names',
      'chunk',
      ['names'] as const,
      calls,
      overrides?.names,
    ),
    editorial: fakeBlock(
      'editorial',
      'brand',
      ['descriptions', 'stockists', 'faq'] as const,
      calls,
      overrides?.editorial,
    ),
    products: fakeBlock(
      'products',
      'brand',
      ['products'] as const,
      calls,
      overrides?.products,
    ),
    persist: fakeBlock('persist', 'brand', [], calls, overrides?.persist),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runBlocks', () => {
  // Catches batch output from one target being checkpointed against its siblings.
  it('checkpoints each target-specific batch result against its own target', async () => {
    const store = fakeStore()
    const registry = buildTestRegistry([])
    registry.names = {
      scope: 'chunk',
      phases: ['names'],
      async runBatch(contexts: BlockContext[]) {
        return new Map(
          contexts.map((ctx) => [
            ctx.targetId,
            {
              output: { patch: { name: ctx.brandId } },
            },
          ]),
        )
      },
    }
    await runBlocks({
      chunk: [makeCtx('María García'), makeCtx('林木工坊')],
      registry,
      order: ['names'],
      concurrency: 2,
      ...emptyMaps(),
      store,
      hooks: {},
      jobId: 'recovery-names',
    })
    expect(
      store.upserted.map((row) => ({
        target: row.target_id,
        output: row.output,
      })),
    ).toEqual([
      {
        target: 'target-María García',
        output: { patch: { name: 'María García' } },
      },
      { target: 'target-林木工坊', output: { patch: { name: '林木工坊' } } },
    ])
  })

  it('runs blocks in block order with barriers', async () => {
    const calls: CallRecord[] = []
    const registry = buildBlockRegistry(buildTestRegistry(calls))
    const chunk = [makeCtx('a'), makeCtx('b'), makeCtx('c')]
    const { satisfaction, force } = emptyMaps()

    await runBlocks({
      chunk,
      registry,
      order: BLOCK_ORDER,
      concurrency: 3,
      satisfaction,
      store: fakeStore(),
      force,
      hooks: {},
      jobId: 'j1',
    })

    // Chunk-scope blocks run once; brand-scope blocks run per brand
    const countBy = (b: string) => calls.filter((c) => c.block === b).length
    expect(countBy('gather')).toBe(1)
    expect(countBy('detect')).toBe(1)
    expect(countBy('acquire')).toBe(3)
    expect(countBy('names')).toBe(1)
    expect(countBy('editorial')).toBe(3)
    expect(countBy('products')).toBe(3)
    expect(countBy('persist')).toBe(3)

    // Every call of block N finishes before block N+1 starts
    const order = calls.map((c) => c.block)
    const first = (b: string) => order.indexOf(b)
    const last = (b: string) => order.lastIndexOf(b)

    expect(last('gather')).toBeLessThan(first('detect'))
    expect(last('detect')).toBeLessThan(first('acquire'))
    expect(last('acquire')).toBeLessThan(first('names'))
    expect(last('names')).toBeLessThan(first('editorial'))
    expect(last('editorial')).toBeLessThan(first('products'))
    expect(last('products')).toBeLessThan(first('persist'))
  })

  it('brand scope blocks respect concurrency', async () => {
    let inflight = 0
    let peak = 0
    const calls: CallRecord[] = []

    const registry = buildBlockRegistry(
      buildTestRegistry(calls, {
        acquire: {
          async run(ctx) {
            calls.push({ block: 'acquire', brandId: ctx.brandId })
            inflight++
            peak = Math.max(peak, inflight)
            await new Promise((r) => setTimeout(r, 10))
            inflight--
            return { output: { patch: {} } }
          },
        },
      }),
    )

    const chunk = Array.from({ length: 5 }, (_, i) => makeCtx(`b${i}`))
    const { satisfaction, force } = emptyMaps()

    await runBlocks({
      chunk,
      registry,
      order: BLOCK_ORDER,
      concurrency: 2,
      satisfaction,
      store: fakeStore(),
      force,
      hooks: {},
      jobId: 'j1',
    })

    expect(peak).toBeLessThanOrEqual(2)
    expect(calls.filter((c) => c.block === 'acquire')).toHaveLength(5)
  })

  it('exited context skips later blocks and barrier input', async () => {
    const calls: CallRecord[] = []

    const registry = buildBlockRegistry(
      buildTestRegistry(calls, {
        acquire: {
          postcondition(ctx) {
            if (ctx.brandId === 'a') {
              return {
                status: 'skipped',
                phaseResult: {
                  phase: 'acquire',
                  status: 'skipped',
                  changedFields: [],
                  durationMs: 0,
                },
              }
            }
            return undefined
          },
        },
      }),
    )

    const chunk = [makeCtx('a'), makeCtx('b'), makeCtx('c')]
    const { satisfaction, force } = emptyMaps()

    await runBlocks({
      chunk,
      registry,
      order: BLOCK_ORDER,
      concurrency: 3,
      satisfaction,
      store: fakeStore(),
      force,
      hooks: {},
      jobId: 'j1',
    })

    // Chunk barrier (names) still fires once for the remaining 2 brands
    expect(calls.filter((c) => c.block === 'names')).toHaveLength(1)

    // Brand-scope blocks after acquire skip the exited brand
    const editorialBrands = calls
      .filter((c) => c.block === 'editorial')
      .map((c) => c.brandId)
    expect(editorialBrands).toHaveLength(2)
    expect(editorialBrands).not.toContain('a')

    const persistBrands = calls
      .filter((c) => c.block === 'persist')
      .map((c) => c.brandId)
    expect(persistBrands).toHaveLength(2)
    expect(persistBrands).not.toContain('a')
  })

  it('barrier skipped when all contexts exited', async () => {
    const calls: CallRecord[] = []

    const registry = buildBlockRegistry(
      buildTestRegistry(calls, {
        acquire: {
          postcondition() {
            return {
              status: 'skipped',
              phaseResult: {
                phase: 'acquire',
                status: 'skipped',
                changedFields: [],
                durationMs: 0,
              },
            }
          },
        },
      }),
    )

    const chunk = [makeCtx('a'), makeCtx('b'), makeCtx('c')]
    const { satisfaction, force } = emptyMaps()

    await runBlocks({
      chunk,
      registry,
      order: BLOCK_ORDER,
      concurrency: 3,
      satisfaction,
      store: fakeStore(),
      force,
      hooks: {},
      jobId: 'j1',
    })

    // names.run is never called (barrier skipped, all exited)
    expect(calls.filter((c) => c.block === 'names')).toHaveLength(0)
  })

  it('satisfied phases are skipped and hydrated', async () => {
    const calls: CallRecord[] = []
    const phaseResults: Array<{
      brandId: string
      phase: string
      status: string
    }> = []

    // Brand 'a' has acquire already satisfied
    const satisfaction = new Map<string, Map<string, Date>>()
    satisfaction.set('target-a', new Map([['acquire', new Date()]]))

    const carryData = { key: 'hydrated' }
    const store = fakeStore({
      latestPerPhase: vi
        .fn()
        .mockImplementation(async (target: { id: string }) => {
          if (target.id === 'target-a') {
            return [
              {
                id: 'r1',
                job_id: 'old',
                target_id: 'target-a',
                target_type: 'brand',
                phase: 'acquire',
                status: 'succeeded',
                output: { patch: {}, carry: carryData },
                persisted_at: null,
                created_at: new Date().toISOString(),
              },
            ]
          }
          return []
        }),
    })

    const hooks: RunBlocksHooks = {
      onPhaseResult(ctx, phase, result) {
        phaseResults.push({
          brandId: ctx.brandId,
          phase,
          status: result.status,
        })
      },
    }

    const registry = buildBlockRegistry(buildTestRegistry(calls))
    const chunk = [makeCtx('a'), makeCtx('b')]

    await runBlocks({
      chunk,
      registry,
      order: BLOCK_ORDER,
      concurrency: 3,
      satisfaction,
      store,
      force: new Map(),
      hooks,
      jobId: 'j1',
    })

    // acquire did NOT run for brand 'a' but DID run for brand 'b'
    const acquireBrands = calls
      .filter((c) => c.block === 'acquire')
      .map((c) => c.brandId)
    expect(acquireBrands).not.toContain('a')
    expect(acquireBrands).toContain('b')

    // Skipped PhaseResult emitted for brand 'a'
    const skipped = phaseResults.filter(
      (r) =>
        r.brandId === 'a' && r.phase === 'acquire' && r.status === 'skipped',
    )
    expect(skipped).toHaveLength(1)

    // Carry hydrated into ctx.state
    const ctxA = chunk.find((c) => c.brandId === 'a')!
    expect(ctxA.state.acquire).toEqual(carryData)
  })

  it('force phases override satisfaction per target', async () => {
    const calls: CallRecord[] = []

    // Both brands have acquire satisfied
    const satisfaction = new Map<string, Map<string, Date>>()
    satisfaction.set('target-a', new Map([['acquire', new Date()]]))
    satisfaction.set('target-b', new Map([['acquire', new Date()]]))

    // Force acquire for brand 'a' only
    const force = new Map<string, Set<string>>()
    force.set('target-a', new Set(['acquire']))

    const registry = buildBlockRegistry(buildTestRegistry(calls))
    const chunk = [makeCtx('a'), makeCtx('b')]

    await runBlocks({
      chunk,
      registry,
      order: BLOCK_ORDER,
      concurrency: 3,
      satisfaction,
      store: fakeStore(),
      force,
      hooks: {},
      jobId: 'j1',
    })

    const acquireBrands = calls
      .filter((c) => c.block === 'acquire')
      .map((c) => c.brandId)
    // 'a' forced — runs despite satisfaction
    expect(acquireBrands).toContain('a')
    // 'b' satisfied and not forced — skipped
    expect(acquireBrands).not.toContain('b')
  })

  it('records phase outputs per owned phase', async () => {
    const calls: CallRecord[] = []
    const store = fakeStore()
    const registry = buildBlockRegistry(buildTestRegistry(calls))
    const chunk = [makeCtx('a')]
    const { satisfaction, force } = emptyMaps()

    await runBlocks({
      chunk,
      registry,
      order: BLOCK_ORDER,
      concurrency: 3,
      satisfaction,
      store,
      force,
      hooks: {},
      jobId: 'j1',
    })

    // editorial owns descriptions, stockists, faq — 3 rows recorded
    const editorialPhases = store.upserted
      .filter(
        (r) =>
          ['descriptions', 'stockists', 'faq'].includes(r.phase as string) &&
          r.target_id === 'target-a',
      )
      .map((r) => r.phase)
      .sort()

    expect(editorialPhases).toEqual(['descriptions', 'faq', 'stockists'])
  })

  it('breaker trip drains chunk then throws', async () => {
    const calls: CallRecord[] = []
    const drained: string[] = []

    const registry = buildBlockRegistry(
      buildTestRegistry(calls, {
        acquire: {
          async run(ctx) {
            calls.push({ block: 'acquire', brandId: ctx.brandId })
            if (ctx.brandId === 'a') {
              const err = new Error('breaker tripped')
              err.name = 'LlmCircuitBreakerError'
              throw err
            }
            await new Promise((r) => setTimeout(r, 20))
            drained.push(ctx.brandId)
            return { output: { patch: {} } }
          },
        },
      }),
    )

    const chunk = [makeCtx('a'), makeCtx('b'), makeCtx('c')]
    const { satisfaction, force } = emptyMaps()

    const result = await runBlocks({
      chunk,
      registry,
      order: BLOCK_ORDER,
      concurrency: 3,
      satisfaction,
      store: fakeStore(),
      force,
      hooks: {},
      jobId: 'j1',
    }).catch((e: unknown) => e)

    expect(result).toBeInstanceOf(Error)
    expect((result as Error).name).toBe('LlmCircuitBreakerError')

    // In-flight brands completed before the throw (drain)
    expect(drained).toContain('b')
    expect(drained).toContain('c')

    // No blocks after acquire ran
    const postAcquire = calls.filter((c) =>
      ['names', 'editorial', 'products', 'persist'].includes(c.block),
    )
    expect(postAcquire).toHaveLength(0)
  })
})
