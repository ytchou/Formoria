import { describe, expect, it, vi, afterEach } from 'vitest'
import { runExperiment, runItems, type ExperimentArm, type ExperimentItem } from '../run-experiment'
import type { PhaseAdapter } from '../phase-adapters'
import type { AuditCollector } from '../zero-write'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<ExperimentItem> = {}): ExperimentItem {
  return {
    id: overrides.id ?? 'item-1',
    input: { brand: 'test' },
    expectedOutput: { isNonBrand: false, confidence: 'high' },
    humanApproval: { reviewedVia: 'langfuse-queue', at: '2026-08-30' },
    ...overrides,
  }
}

function makeUnreviewedItem(id = 'unreviewed-1'): ExperimentItem {
  return {
    id,
    input: { brand: 'test' },
    expectedOutput: { isNonBrand: false, confidence: 'high' },
    humanApproval: {},
  }
}

function makeAdapter(overrides: Partial<PhaseAdapter> = {}): PhaseAdapter {
  return {
    promptName: 'detect',
    fallbackPrompt: 'You are a brand detector.',
    profileKey: 'detectBatch',
    outputSchema: { safeParse: () => ({ success: true }) } as never,
    requestSchema: { name: 'detect', schema: {} },
    parseOutput: (content: string) => {
      try {
        const data = JSON.parse(content)
        return { ok: true as const, data }
      } catch (e) {
        return { ok: false as const, error: e }
      }
    },
    unwrap: (output) => output,
    expectedOf: (item) => item.expectedOutput,
    expectedSchema: { safeParse: () => ({ success: true }) } as never,
    scorers: [
      { name: 'decisionAgreement', fn: () => 1 },
      { name: 'confidenceBand', fn: () => 0.5 },
    ],
    mode: 'scored',
    ...overrides,
  }
}

function makeArm(overrides: Partial<ExperimentArm> = {}): ExperimentArm {
  return {
    name: 'gpt-5.6',
    type: 'model',
    value: 'gpt-5.6-luna',
    ...overrides,
  }
}

function makeCollector(): AuditCollector {
  const records: Array<{ correlationId: string; costUsd?: number | null; latencyMs?: number | null }> = []
  return {
    push(record) {
      records.push(record)
    },
    byCorrelation(id) {
      return records.filter((r) => r.correlationId === id) as never
    },
    all() {
      return [...records] as never
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runExperiment', () => {
  afterEach(() => {
    delete process.env.LANGFUSE_PROMPT_VERSIONS
    delete process.env.OPENAI_MODEL_OVERRIDE
  })

  it('refuses items without humanApproval.reviewedVia unless allowUnreviewed', async () => {
    const items = [makeItem({ id: 'ok-1' }), makeUnreviewedItem('bad-1'), makeUnreviewedItem('bad-2')]

    await expect(
      runExperiment({
        dataset: 'test-golden',
        arms: [makeArm()],
        adapter: makeAdapter(),
        items,
        deps: {
          callModel: vi.fn(),
          writeFile: vi.fn(),
          now: () => new Date('2026-09-04'),
          flushLangfuse: vi.fn(),
          fetchPrompt: vi.fn().mockResolvedValue({ text: 'prompt', prompt: null }),
          installSeams: () => ({ collector: makeCollector(), restore: vi.fn() }),
          assertNoNewAuditRows: vi.fn(),
          runWithAuditContext: <T>(_seed: unknown, fn: () => T): T => fn(),
          getAuditContext: () => ({ correlationId: null }),
        },
      }),
    ).rejects.toThrow(/bad-1.*bad-2/)
  })

  it('with allowUnreviewed, the result carries provisional: true', async () => {
    const callModel = vi.fn().mockResolvedValue({
      ok: true,
      content: JSON.stringify({ isNonBrand: false, confidence: 'high' }),
    })

    const result = await runExperiment({
      dataset: 'test-golden',
      arms: [makeArm()],
      adapter: makeAdapter(),
      items: [makeUnreviewedItem('u-1')],
      allowUnreviewed: true,
      deps: {
        callModel,
        writeFile: vi.fn(),
        now: () => new Date('2026-09-04'),
        flushLangfuse: vi.fn(),
        fetchPrompt: vi.fn().mockResolvedValue({ text: 'prompt', prompt: null }),
        installSeams: () => ({ collector: makeCollector(), restore: vi.fn() }),
        assertNoNewAuditRows: vi.fn(),
        runWithAuditContext: <T>(_seed: unknown, fn: () => T): T => fn(),
        getAuditContext: () => ({ correlationId: null }),
      },
    })

    expect(result.provisional).toBe(true)
  })

  it('runs each arm over each item with concurrency 4 and one retry', async () => {
    let concurrent = 0
    let maxConcurrent = 0
    let callCount = 0

    const callModel = vi.fn().mockImplementation(async () => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      callCount++
      await new Promise((r) => setTimeout(r, 10))
      concurrent--
      return {
        ok: true,
        content: JSON.stringify({ isNonBrand: false, confidence: 'high' }),
      }
    })

    const items = Array.from({ length: 6 }, (_, i) => makeItem({ id: `item-${i}` }))

    const result = await runExperiment({
      dataset: 'test-golden',
      arms: [makeArm()],
      adapter: makeAdapter(),
      items,
      concurrency: 4,
      deps: {
        callModel,
        writeFile: vi.fn(),
        now: () => new Date('2026-09-04'),
        flushLangfuse: vi.fn(),
        fetchPrompt: vi.fn().mockResolvedValue({ text: 'prompt', prompt: null }),
        installSeams: () => ({ collector: makeCollector(), restore: vi.fn() }),
        assertNoNewAuditRows: vi.fn(),
        runWithAuditContext: <T>(_seed: unknown, fn: () => T): T => fn(),
        getAuditContext: () => ({ correlationId: null }),
      },
    })

    // With 6 items and concurrency 4, max concurrent should be at most 4
    expect(maxConcurrent).toBeLessThanOrEqual(4)
    expect(callCount).toBe(6)
    expect(result.exitCode).toBe(0)
  })

  it('a failing item is attempted twice (one retry)', async () => {
    let attempts = 0
    const callModel = vi.fn().mockImplementation(async () => {
      attempts++
      throw new Error('model error')
    })

    const result = await runExperiment({
      dataset: 'test-golden',
      arms: [makeArm()],
      adapter: makeAdapter(),
      items: [makeItem({ id: 'fail-1' })],
      deps: {
        callModel,
        writeFile: vi.fn(),
        now: () => new Date('2026-09-04'),
        flushLangfuse: vi.fn(),
        fetchPrompt: vi.fn().mockResolvedValue({ text: 'prompt', prompt: null }),
        installSeams: () => ({ collector: makeCollector(), restore: vi.fn() }),
        assertNoNewAuditRows: vi.fn(),
        runWithAuditContext: <T>(_seed: unknown, fn: () => T): T => fn(),
        getAuditContext: () => ({ correlationId: null }),
      },
    })

    // 2 attempts = 1 original + 1 retry
    expect(attempts).toBe(2)
    expect(result.summary.failed).toBe(1)
    expect(result.exitCode).toBe(1)
  })

  it('a failed item scores 0 on every evaluator, ok:false, and the run reports failures', async () => {
    const callModel = vi.fn().mockRejectedValue(new Error('boom'))

    const result = await runExperiment({
      dataset: 'test-golden',
      arms: [makeArm()],
      adapter: makeAdapter(),
      items: [makeItem({ id: 'fail-1' })],
      deps: {
        callModel,
        writeFile: vi.fn(),
        now: () => new Date('2026-09-04'),
        flushLangfuse: vi.fn(),
        fetchPrompt: vi.fn().mockResolvedValue({ text: 'prompt', prompt: null }),
        installSeams: () => ({ collector: makeCollector(), restore: vi.fn() }),
        assertNoNewAuditRows: vi.fn(),
        runWithAuditContext: <T>(_seed: unknown, fn: () => T): T => fn(),
        getAuditContext: () => ({ correlationId: null }),
      },
    })

    expect(result.summary.failed).toBe(1)
    expect(result.exitCode).toBe(1)

    // The item record should have ok: false and score 0 on every evaluator
    const armResult = result.armResults[0]!
    const itemResult = armResult.items[0]!
    expect(itemResult.ok).toBe(false)
    expect(itemResult.scores.decisionAgreement).toBe(0)
    expect(itemResult.scores.confidenceBand).toBe(0)
  })

  it('per-arm env is set and restored', async () => {
    const envCaptures: string[] = []

    const callModel = vi.fn().mockImplementation(async () => {
      envCaptures.push(process.env.OPENAI_MODEL_OVERRIDE ?? 'unset')
      return {
        ok: true,
        content: JSON.stringify({ isNonBrand: false }),
      }
    })

    const arms: ExperimentArm[] = [
      { name: 'model-a', type: 'model', value: 'gpt-5.6-luna' },
      { name: 'model-b', type: 'model', value: 'gpt-5.7-sol' },
    ]

    await runExperiment({
      dataset: 'test-golden',
      arms,
      adapter: makeAdapter(),
      items: [makeItem()],
      deps: {
        callModel,
        writeFile: vi.fn(),
        now: () => new Date('2026-09-04'),
        flushLangfuse: vi.fn(),
        fetchPrompt: vi.fn().mockResolvedValue({ text: 'prompt', prompt: null }),
        installSeams: () => ({ collector: makeCollector(), restore: vi.fn() }),
        assertNoNewAuditRows: vi.fn(),
        runWithAuditContext: <T>(_seed: unknown, fn: () => T): T => fn(),
        getAuditContext: () => ({ correlationId: null }),
      },
    })

    expect(envCaptures[0]).toBe('gpt-5.6-luna')
    expect(envCaptures[1]).toBe('gpt-5.7-sol')

    // After run, env should be restored
    expect(process.env.OPENAI_MODEL_OVERRIDE).toBeUndefined()
  })

  it('prompt arm sets LANGFUSE_PROMPT_VERSIONS and restores', async () => {
    const envCaptures: string[] = []

    const callModel = vi.fn().mockImplementation(async () => {
      envCaptures.push(process.env.LANGFUSE_PROMPT_VERSIONS ?? 'unset')
      return {
        ok: true,
        content: JSON.stringify({ isNonBrand: false }),
      }
    })

    const arms: ExperimentArm[] = [
      { name: 'prompt-v3', type: 'prompt', value: 'detect:3' },
    ]

    await runExperiment({
      dataset: 'test-golden',
      arms,
      adapter: makeAdapter(),
      items: [makeItem()],
      deps: {
        callModel,
        writeFile: vi.fn(),
        now: () => new Date('2026-09-04'),
        flushLangfuse: vi.fn(),
        fetchPrompt: vi.fn().mockResolvedValue({ text: 'prompt', prompt: null }),
        installSeams: () => ({ collector: makeCollector(), restore: vi.fn() }),
        assertNoNewAuditRows: vi.fn(),
        runWithAuditContext: <T>(_seed: unknown, fn: () => T): T => fn(),
        getAuditContext: () => ({ correlationId: null }),
      },
    })

    expect(envCaptures[0]).toBe('detect:3')
    expect(process.env.LANGFUSE_PROMPT_VERSIONS).toBeUndefined()
  })

  it('each item runs under runWithAuditContext with its own correlationId', async () => {
    const auditContextSeeds: unknown[] = []

    const callModel = vi.fn().mockImplementation(async () => {
      return {
        ok: true,
        content: JSON.stringify({ isNonBrand: false }),
      }
    })

    const mockRunWithAuditContext = vi.fn().mockImplementation((seed: unknown, fn: () => unknown) => {
      auditContextSeeds.push(seed)
      return fn()
    })

    const collector = makeCollector()
    // Simulate some audit records
    collector.push({ correlationId: 'will-be-replaced', costUsd: 0.01, latencyMs: 100 } as never)

    await runExperiment({
      dataset: 'test-golden',
      arms: [makeArm()],
      adapter: makeAdapter(),
      items: [makeItem({ id: 'item-a' }), makeItem({ id: 'item-b' })],
      deps: {
        callModel,
        writeFile: vi.fn(),
        now: () => new Date('2026-09-04'),
        flushLangfuse: vi.fn(),
        fetchPrompt: vi.fn().mockResolvedValue({ text: 'prompt', prompt: null }),
        installSeams: () => ({ collector, restore: vi.fn() }),
        assertNoNewAuditRows: vi.fn(),
        runWithAuditContext: mockRunWithAuditContext,
        getAuditContext: () => ({ correlationId: null }),
      },
    })

    expect(mockRunWithAuditContext).toHaveBeenCalledTimes(2)
    // Each call should have a unique correlationId
    const ids = auditContextSeeds.map((s) => (s as Record<string, unknown>).correlationId)
    expect(new Set(ids).size).toBe(2)
    for (const id of ids) {
      expect(typeof id).toBe('string')
      expect((id as string).length).toBeGreaterThan(0)
    }
  })

  it('model content is parsed through adapter.parseOutput before unwrap', async () => {
    // adapter.parseOutput will reject invalid content
    const adapter = makeAdapter({
      parseOutput: (content: string) => {
        try {
          const data = JSON.parse(content)
          if (!data.isNonBrand && data.isNonBrand !== false) {
            return { ok: false as const, error: new Error('missing isNonBrand') }
          }
          return { ok: true as const, data }
        } catch (e) {
          return { ok: false as const, error: e }
        }
      },
    })

    // Return content that fails parseOutput
    const callModel = vi.fn().mockResolvedValue({
      ok: true,
      content: JSON.stringify({ wrong: 'shape' }),
    })

    const result = await runExperiment({
      dataset: 'test-golden',
      arms: [makeArm()],
      adapter,
      items: [makeItem()],
      deps: {
        callModel,
        writeFile: vi.fn(),
        now: () => new Date('2026-09-04'),
        flushLangfuse: vi.fn(),
        fetchPrompt: vi.fn().mockResolvedValue({ text: 'prompt', prompt: null }),
        installSeams: () => ({ collector: makeCollector(), restore: vi.fn() }),
        assertNoNewAuditRows: vi.fn(),
        runWithAuditContext: <T>(_seed: unknown, fn: () => T): T => fn(),
        getAuditContext: () => ({ correlationId: null }),
      },
    })

    // Should be treated as a failed item
    const itemResult = result.armResults[0]!.items[0]!
    expect(itemResult.ok).toBe(false)
    expect(result.summary.failed).toBe(1)
  })

  it('aggregates per-scorer mean, cost per item, p95 latency from collector records', async () => {
    const collector = makeCollector()

    const callModel = vi.fn().mockImplementation(async (_input: unknown, _opts: unknown, itemRunId: string) => {
      // Push audit records for this item
      collector.push({
        correlationId: itemRunId,
        costUsd: 0.01,
        latencyMs: 100,
      } as never)
      return {
        ok: true,
        content: JSON.stringify({ isNonBrand: false, confidence: 'high' }),
      }
    })

    const adapter = makeAdapter({
      scorers: [
        { name: 'score_a', fn: () => 0.8 },
        { name: 'score_b', fn: () => 0.6 },
      ],
    })

    const result = await runExperiment({
      dataset: 'test-golden',
      arms: [makeArm()],
      adapter,
      items: [makeItem({ id: 'i1' }), makeItem({ id: 'i2' })],
      deps: {
        callModel,
        writeFile: vi.fn(),
        now: () => new Date('2026-09-04'),
        flushLangfuse: vi.fn(),
        fetchPrompt: vi.fn().mockResolvedValue({ text: 'prompt', prompt: null }),
        installSeams: () => ({ collector, restore: vi.fn() }),
        assertNoNewAuditRows: vi.fn(),
        runWithAuditContext: <T>(_seed: unknown, fn: () => T): T => fn(),
        getAuditContext: () => ({ correlationId: null }),
      },
    })

    // Verify summary aggregations
    const armSummary = result.armResults[0]!.summary
    expect(armSummary.scorerMeans.score_a).toBe(0.8)
    expect(armSummary.scorerMeans.score_b).toBe(0.6)
    expect(typeof armSummary.costPerItem).toBe('number')
    expect(typeof armSummary.p95LatencyMs).toBe('number')
  })

  it('writes run JSON with items, arms, scores via injected writeFile', async () => {
    const writeFile = vi.fn()

    const callModel = vi.fn().mockResolvedValue({
      ok: true,
      content: JSON.stringify({ isNonBrand: false, confidence: 'high' }),
    })

    await runExperiment({
      dataset: 'test-golden',
      arms: [makeArm()],
      adapter: makeAdapter(),
      items: [makeItem()],
      deps: {
        callModel,
        writeFile,
        now: () => new Date('2026-09-04T12:00:00.000Z'),
        flushLangfuse: vi.fn(),
        fetchPrompt: vi.fn().mockResolvedValue({ text: 'prompt', prompt: null }),
        installSeams: () => ({ collector: makeCollector(), restore: vi.fn() }),
        assertNoNewAuditRows: vi.fn(),
        runWithAuditContext: <T>(_seed: unknown, fn: () => T): T => fn(),
        getAuditContext: () => ({ correlationId: null }),
      },
    })

    expect(writeFile).toHaveBeenCalledTimes(1)
    const [path, content] = writeFile.mock.calls[0]!
    expect(path).toContain('scripts/llm-eval/runs/')
    expect(path).toContain('.json')

    const parsed = JSON.parse(content as string)
    expect(parsed).toHaveProperty('arms')
    expect(parsed).toHaveProperty('items')
    expect(parsed).toHaveProperty('scores')
  })
})

describe('runItems export', () => {
  it('is exported for composition by Task 11', () => {
    expect(typeof runItems).toBe('function')
  })
})
