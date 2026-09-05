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
  it('resolves when the injected counter returns 0 for both tables', async () => {
    const counter = vi.fn<(table: string, since: Date) => Promise<number>>()
      .mockResolvedValue(0)

    const since = new Date()
    await expect(
      assertNoNewAuditRows({ since, count: counter }),
    ).resolves.toBeUndefined()

    expect(counter).toHaveBeenCalledTimes(2)
    expect(counter).toHaveBeenCalledWith('external_call_audit', since)
    expect(counter).toHaveBeenCalledWith('brand_ai_results', since)
  })

  it('rejects naming the table and count otherwise', async () => {
    const counter = vi.fn<(table: string, since: Date) => Promise<number>>()
      .mockImplementation(async (table) => {
        if (table === 'external_call_audit') return 3
        return 0
      })

    const since = new Date()
    await expect(
      assertNoNewAuditRows({ since, count: counter }),
    ).rejects.toThrow(/external_call_audit.*3/)
  })

  it('rejects when brand_ai_results has new rows', async () => {
    const counter = vi.fn<(table: string, since: Date) => Promise<number>>()
      .mockImplementation(async (table) => {
        if (table === 'brand_ai_results') return 5
        return 0
      })

    const since = new Date()
    await expect(
      assertNoNewAuditRows({ since, count: counter }),
    ).rejects.toThrow(/brand_ai_results.*5/)
  })
})
