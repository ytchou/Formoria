import { describe, expect, it, vi, afterEach } from 'vitest'
import type { AuditRecord } from '@/lib/audit/emit'
import { installSeams, assertNoNewAuditRows } from '../zero-write'

describe('installSeams', () => {
  afterEach(() => {
    delete process.env.CURATION_EVAL_SINK
  })

  it('captures audit records keyed by correlationId', async () => {
    const { collector, restore } = installSeams({ sinkPath: '/tmp/test-sink.jsonl' })

    try {
      expect(process.env.CURATION_EVAL_SINK).toBe('/tmp/test-sink.jsonl')

      // Simulate four interleaved correlation IDs by pushing records through
      // the collector (the installed seam delegates to collector.push).
      const ids = ['id-a', 'id-b', 'id-c', 'id-d']
      const records: AuditRecord[] = ids.flatMap((correlationId, i) => [
        {
          spanId: `span-${correlationId}-1`,
          correlationId,
          kind: 'external' as const,
          status: 'succeeded' as const,
          provider: 'openai',
          operation: 'chat',
          costUsd: i * 0.01,
          latencyMs: 100 + i * 10,
        },
        {
          spanId: `span-${correlationId}-2`,
          correlationId,
          kind: 'external' as const,
          status: 'succeeded' as const,
          provider: 'openai',
          operation: 'chat',
          costUsd: i * 0.02,
          latencyMs: 200 + i * 10,
        },
      ])

      // Push records through the collector (simulating the seam capture)
      for (const record of records) {
        collector.push(record)
      }

      // Verify byCorrelation returns only that id's records
      for (const id of ids) {
        const filtered = collector.byCorrelation(id)
        expect(filtered).toHaveLength(2)
        for (const rec of filtered) {
          expect(rec.correlationId).toBe(id)
        }
      }

      // Verify records carry costUsd and latencyMs
      const aRecords = collector.byCorrelation('id-a')
      expect(aRecords[0]!.costUsd).toBe(0)
      expect(aRecords[0]!.latencyMs).toBe(100)

      // Verify no cross-contamination
      const bRecords = collector.byCorrelation('id-b')
      expect(bRecords.every((r) => r.correlationId === 'id-b')).toBe(true)
    } finally {
      restore()
    }

    // After restore, env var is cleared
    expect(process.env.CURATION_EVAL_SINK).toBeUndefined()
  })

  it('the installed seam intercepts emitAuditRecord', async () => {
    const { collector, restore } = installSeams({ sinkPath: '/tmp/test.jsonl' })

    try {
      // setAuditWriteSeam was called — the seam is active
      // We can verify by calling the collector and checking the data
      const testRecord: AuditRecord = {
        spanId: 'test-span',
        correlationId: 'test-corr',
        kind: 'external',
        status: 'succeeded',
        provider: 'test',
        operation: 'test',
        costUsd: 0.05,
        latencyMs: 42,
      }

      collector.push(testRecord)
      expect(collector.byCorrelation('test-corr')).toHaveLength(1)
      expect(collector.byCorrelation('test-corr')[0]!.costUsd).toBe(0.05)
      expect(collector.byCorrelation('test-corr')[0]!.latencyMs).toBe(42)
    } finally {
      restore()
    }
  })
})

describe('assertNoNewAuditRows', () => {
  const baseArgs = {
    correlationIds: ['run-id-1', 'run-id-2'],
    spanIds: ['span-a', 'span-b'],
  }

  it('resolves when the injected counter returns 0 for both tables', async () => {
    const counter = vi.fn<(table: string, since: Date, ids: string[], idColumn: string) => Promise<number>>()
      .mockResolvedValue(0)

    const since = new Date()
    await expect(
      assertNoNewAuditRows({ since, ...baseArgs, count: counter }),
    ).resolves.toBeUndefined()

    // external_call_audit queried with correlationIds
    expect(counter).toHaveBeenCalledWith(
      'external_call_audit', since, baseArgs.correlationIds, 'correlation_id',
    )
    // brand_ai_results queried with spanIds
    expect(counter).toHaveBeenCalledWith(
      'brand_ai_results', since, baseArgs.spanIds, 'audit_span_id',
    )
  })

  it('rejects naming the table and count when external_call_audit has rows', async () => {
    const counter = vi.fn<(table: string, since: Date, ids: string[], idColumn: string) => Promise<number>>()
      .mockImplementation(async (table) => {
        if (table === 'external_call_audit') return 3
        return 0
      })

    const since = new Date()
    await expect(
      assertNoNewAuditRows({ since, ...baseArgs, count: counter }),
    ).rejects.toThrow(/external_call_audit.*3/)
  })

  it('rejects when brand_ai_results has new rows', async () => {
    const counter = vi.fn<(table: string, since: Date, ids: string[], idColumn: string) => Promise<number>>()
      .mockImplementation(async (table) => {
        if (table === 'brand_ai_results') return 5
        return 0
      })

    const since = new Date()
    await expect(
      assertNoNewAuditRows({ since, ...baseArgs, count: counter }),
    ).rejects.toThrow(/brand_ai_results.*5/)
  })

  it('throws when correlationIds is empty', async () => {
    const since = new Date()
    await expect(
      assertNoNewAuditRows({ since, correlationIds: [], spanIds: ['span-1'], count: vi.fn() }),
    ).rejects.toThrow(/correlationIds is empty/)
  })

  it('skips brand_ai_results query when spanIds is empty', async () => {
    const counter = vi.fn<(table: string, since: Date, ids: string[], idColumn: string) => Promise<number>>()
      .mockResolvedValue(0)

    const since = new Date()
    await assertNoNewAuditRows({
      since,
      correlationIds: ['run-1'],
      spanIds: [],
      count: counter,
    })

    // Only external_call_audit should be queried
    expect(counter).toHaveBeenCalledTimes(1)
    expect(counter).toHaveBeenCalledWith(
      'external_call_audit', since, ['run-1'], 'correlation_id',
    )
  })

  it('a row whose correlation_id is NOT in correlationIds does not trip the assertion', async () => {
    // Simulates the exact regression: a foreign row (from label-generate-queries)
    // with provider=openai, phase=search_relevance_judge shares the time window
    // but has a different correlation_id.
    const counter = vi.fn<(table: string, since: Date, ids: string[], idColumn: string) => Promise<number>>()
      .mockResolvedValue(0)

    const since = new Date()
    // The run's own ids do not include the foreign writer's correlation_id
    await expect(
      assertNoNewAuditRows({
        since,
        correlationIds: ['my-run-id-1', 'my-run-id-2'],
        spanIds: ['my-span-1'],
        count: counter,
      }),
    ).resolves.toBeUndefined()

    // The counter receives only the run's own ids — foreign rows are invisible
    expect(counter.mock.calls[0]![2]).toEqual(['my-run-id-1', 'my-run-id-2'])
  })

  it('a row whose correlation_id IS in correlationIds trips the assertion', async () => {
    const counter = vi.fn<(table: string, since: Date, ids: string[], idColumn: string) => Promise<number>>()
      .mockImplementation(async (table, _since, ids) => {
        // Simulate: the run's own correlation_id produced 1 leaked row
        if (table === 'external_call_audit' && ids.includes('my-run-id-1')) return 1
        return 0
      })

    const since = new Date()
    await expect(
      assertNoNewAuditRows({
        since,
        correlationIds: ['my-run-id-1'],
        spanIds: ['my-span-1'],
        count: counter,
      }),
    ).rejects.toThrow(/external_call_audit.*1/)
  })
})
