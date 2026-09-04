import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { enqueueDataset, applyVerdicts } from '../golden-review'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    status: 'ACTIVE' as const,
    input: { brand: 'test-brand', url: 'https://example.com' },
    expectedOutput: { isNonBrand: false, confidence: 'high' },
    metadata: {},
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// enqueueDataset
// ---------------------------------------------------------------------------

describe('enqueueDataset', () => {
  it('creates one trace per ACTIVE item with input, prelabel rationale, boundaryTags, expected, and enqueues it', async () => {
    const traceFn = vi
      .fn()
      .mockReturnValueOnce({ id: 'trace-1' })
      .mockReturnValueOnce({ id: 'trace-2' })
    const enqueueFn = vi.fn().mockResolvedValue(undefined)

    const items = [
      makeItem({ id: 'item-a' }),
      makeItem({
        id: 'item-b',
        expectedOutput: {
          isNonBrand: true,
          confidence: 'low',
          rationale: 'not a brand',
          boundaryTags: ['personal'],
        },
      }),
      makeItem({ id: 'item-c', status: 'ARCHIVED' }),
    ]

    const result = await enqueueDataset({
      dataset: 'detect-confidence-golden',
      queueName: 'golden-review',
      deps: {
        getDataset: vi.fn().mockResolvedValue({ items }),
        trace: traceFn,
        findQueueByName: vi.fn().mockResolvedValue('queue-abc'),
        enqueueTrace: enqueueFn,
      },
    })

    // Only 2 ACTIVE items enqueued
    expect(result).toEqual({ enqueued: 2, queueName: 'golden-review' })
    expect(traceFn).toHaveBeenCalledTimes(2)
    expect(enqueueFn).toHaveBeenCalledTimes(2)

    // Trace metadata carries datasetName + itemId
    const first = traceFn.mock.calls[0]![0]
    expect(first.metadata).toEqual(
      expect.objectContaining({
        datasetName: 'detect-confidence-golden',
        itemId: 'item-a',
      }),
    )
    expect(first.input).toEqual(items[0]!.input)

    // Second trace carries expectedOutput fields (rationale, boundaryTags)
    const second = traceFn.mock.calls[1]![0]
    expect(second.output).toEqual(
      expect.objectContaining({ expectedOutput: items[1]!.expectedOutput }),
    )

    // Enqueue uses correct queueId and traceId
    expect(enqueueFn).toHaveBeenCalledWith({
      queueId: 'queue-abc',
      traceId: 'trace-1',
    })
    expect(enqueueFn).toHaveBeenCalledWith({
      queueId: 'queue-abc',
      traceId: 'trace-2',
    })
  })
})

// ---------------------------------------------------------------------------
// applyVerdicts
// ---------------------------------------------------------------------------

describe('applyVerdicts', () => {
  const expectedSchema = z.object({
    isNonBrand: z.boolean(),
    confidence: z.string(),
  })

  function baseDeps(overrides: Record<string, unknown> = {}) {
    return {
      getDataset: vi.fn().mockResolvedValue({
        items: [makeItem({ id: 'item-1' }), makeItem({ id: 'item-2' })],
      }),
      listScores: vi.fn().mockResolvedValue([]),
      getTrace: vi.fn().mockResolvedValue({
        metadata: {
          datasetName: 'detect-confidence-golden',
          itemId: 'item-1',
        },
      }),
      createDatasetItem: vi.fn().mockResolvedValue({}),
      adapterFor: vi.fn().mockReturnValue({ expectedSchema }),
      ...overrides,
    }
  }

  it('maps approve → ACTIVE with reviewedVia', async () => {
    const createDatasetItem = vi.fn().mockResolvedValue({})

    await applyVerdicts({
      dataset: 'detect-confidence-golden',
      queueName: 'golden-review',
      approvedBy: 'patrick',
      deps: baseDeps({
        listScores: vi.fn().mockResolvedValue([
          {
            id: 'score-1',
            name: 'golden_verdict',
            value: 1,
            traceId: 'trace-1',
            queueId: 'q-1',
          },
        ]),
        getTrace: vi.fn().mockResolvedValue({
          metadata: {
            datasetName: 'detect-confidence-golden',
            itemId: 'item-1',
          },
        }),
        createDatasetItem,
      }),
    })

    expect(createDatasetItem).toHaveBeenCalledTimes(1)
    const body = createDatasetItem.mock.calls[0]![0] as Record<string, unknown>
    expect(body.id).toBe('item-1')

    const meta = body.metadata as Record<string, unknown>
    const ha = meta.humanApproval as Record<string, unknown>
    expect(ha.status).toBe('approved')
    expect(ha.reviewedVia).toEqual({ queueId: 'q-1', scoreId: 'score-1' })
    expect(ha.approvedBy).toBe('patrick')
  })

  it('maps edit → merged expectedOutput validated by adapter.expectedSchema', async () => {
    // --- Part 1: valid edit merges fields ---
    const createOk = vi.fn().mockResolvedValue({})

    await applyVerdicts({
      dataset: 'detect-confidence-golden',
      queueName: 'golden-review',
      approvedBy: 'patrick',
      deps: baseDeps({
        listScores: vi.fn().mockResolvedValue([
          {
            id: 'score-2',
            name: 'golden_verdict',
            value: 0.5,
            traceId: 'trace-1',
            queueId: 'q-1',
            comment: '{"confidence":"medium"}',
          },
        ]),
        getTrace: vi.fn().mockResolvedValue({
          metadata: {
            datasetName: 'detect-confidence-golden',
            itemId: 'item-1',
          },
        }),
        createDatasetItem: createOk,
      }),
    })

    expect(createOk).toHaveBeenCalledTimes(1)
    const body = createOk.mock.calls[0]![0] as Record<string, unknown>
    expect(body.expectedOutput).toEqual({
      isNonBrand: false,
      confidence: 'medium',
    })
    const meta = body.metadata as Record<string, unknown>
    const ha = meta.humanApproval as Record<string, unknown>
    expect(ha.status).toBe('approved')

    // --- Part 2: invalid JSON aborts the whole push ---
    const createBad = vi.fn().mockResolvedValue({})

    await expect(
      applyVerdicts({
        dataset: 'detect-confidence-golden',
        queueName: 'golden-review',
        approvedBy: 'patrick',
        deps: baseDeps({
          listScores: vi.fn().mockResolvedValue([
            {
              id: 'score-3',
              name: 'golden_verdict',
              value: 0.5,
              traceId: 'trace-1',
              queueId: 'q-1',
              comment: 'not valid json',
            },
          ]),
          getTrace: vi.fn().mockResolvedValue({
            metadata: {
              datasetName: 'detect-confidence-golden',
              itemId: 'item-1',
            },
          }),
          createDatasetItem: createBad,
        }),
      }),
    ).rejects.toThrow(/item-1/)

    expect(createBad).not.toHaveBeenCalled()
  })

  it('maps reject → status ARCHIVED', async () => {
    const createDatasetItem = vi.fn().mockResolvedValue({})

    await applyVerdicts({
      dataset: 'detect-confidence-golden',
      queueName: 'golden-review',
      approvedBy: 'patrick',
      deps: baseDeps({
        listScores: vi.fn().mockResolvedValue([
          {
            id: 'score-4',
            name: 'golden_verdict',
            value: 0,
            traceId: 'trace-1',
            queueId: 'q-1',
          },
        ]),
        getTrace: vi.fn().mockResolvedValue({
          metadata: {
            datasetName: 'detect-confidence-golden',
            itemId: 'item-1',
          },
        }),
        createDatasetItem,
      }),
    })

    expect(createDatasetItem).toHaveBeenCalledTimes(1)
    const body = createDatasetItem.mock.calls[0]![0] as Record<string, unknown>
    expect(body.status).toBe('ARCHIVED')

    const meta = body.metadata as Record<string, unknown>
    const ha = meta.humanApproval as Record<string, unknown>
    expect(ha.status).toBe('rejected')
  })

  it('items with no verdict are left untouched and reported pending', async () => {
    const createDatasetItem = vi.fn().mockResolvedValue({})

    const result = await applyVerdicts({
      dataset: 'detect-confidence-golden',
      queueName: 'golden-review',
      approvedBy: 'patrick',
      deps: baseDeps({
        getDataset: vi.fn().mockResolvedValue({
          items: [
            makeItem({ id: 'item-1' }),
            makeItem({ id: 'item-2' }),
            makeItem({ id: 'item-3' }),
          ],
        }),
        listScores: vi.fn().mockResolvedValue([
          {
            id: 'score-1',
            name: 'golden_verdict',
            value: 1,
            traceId: 'trace-1',
            queueId: 'q-1',
          },
        ]),
        getTrace: vi.fn().mockResolvedValue({
          metadata: {
            datasetName: 'detect-confidence-golden',
            itemId: 'item-1',
          },
        }),
        createDatasetItem,
      }),
    })

    expect(result.processed).toBe(1)
    expect(result.pending).toBe(2)
    expect(result.summary).toEqual({
      approved: 1,
      rejected: 0,
      edited: 0,
      pending: 2,
    })
  })
})
