import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { enqueueDataset, applyVerdicts, prelabelItem } from '../golden-review'

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

  it('includes ARCHIVED items with humanApproval.status pending and excludes rejected/bare archived', async () => {
    const traceFn = vi
      .fn()
      .mockReturnValueOnce({ id: 'trace-1' })
      .mockReturnValueOnce({ id: 'trace-2' })
    const enqueueFn = vi.fn().mockResolvedValue(undefined)

    const items = [
      makeItem({ id: 'active-1' }),
      makeItem({
        id: 'archived-pending',
        status: 'ARCHIVED',
        metadata: { humanApproval: { status: 'pending' } },
      }),
      makeItem({
        id: 'archived-rejected',
        status: 'ARCHIVED',
        metadata: { humanApproval: { status: 'rejected' } },
      }),
      makeItem({
        id: 'archived-bare',
        status: 'ARCHIVED',
      }),
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

    expect(result.enqueued).toBe(2)
    const tracedIds = traceFn.mock.calls.map(
      (c) => (c[0] as { metadata: { itemId: string } }).metadata.itemId,
    )
    expect(tracedIds).toEqual(['active-1', 'archived-pending'])
  })

  it('uses reviewView for the trace input when provided', async () => {
    const traceFn = vi.fn().mockReturnValue({ id: 'trace-1' })
    const enqueueFn = vi.fn().mockResolvedValue(undefined)

    const items = [
      makeItem({
        id: 'item-1',
        input: { brand: 'test', pool: [{ url: 'https://a.com' }] },
      }),
    ]

    const result = await enqueueDataset({
      dataset: 'test-dataset',
      queueName: 'golden-review',
      reviewView: (_item) => ({ projected: true }),
      deps: {
        getDataset: vi.fn().mockResolvedValue({ items }),
        trace: traceFn,
        findQueueByName: vi.fn().mockResolvedValue('queue-abc'),
        enqueueTrace: enqueueFn,
      },
    })

    expect(result.enqueued).toBe(1)
    const traceInput = (traceFn.mock.calls[0]![0] as { input: unknown }).input
    expect(traceInput).toEqual({ projected: true })
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

  it('sets status ACTIVE on approve and on edit', async () => {
    const createDatasetItem = vi.fn().mockResolvedValue({})

    await applyVerdicts({
      dataset: 'detect-confidence-golden',
      queueName: 'golden-review',
      approvedBy: 'patrick',
      deps: baseDeps({
        listScores: vi.fn().mockResolvedValue([
          {
            id: 'score-a',
            name: 'golden_verdict',
            value: 1,
            traceId: 'trace-1',
            queueId: 'q-1',
          },
          {
            id: 'score-e',
            name: 'golden_verdict',
            value: 0.5,
            traceId: 'trace-2',
            queueId: 'q-1',
            comment: '{"confidence":"medium"}',
          },
        ]),
        getTrace: vi.fn().mockImplementation((traceId: string) => {
          const map: Record<string, string> = {
            'trace-1': 'item-1',
            'trace-2': 'item-2',
          }
          return Promise.resolve({ metadata: { itemId: map[traceId] } })
        }),
        createDatasetItem,
      }),
    })

    expect(createDatasetItem).toHaveBeenCalledTimes(2)

    // Approve body carries status ACTIVE
    const approveBody = createDatasetItem.mock.calls[0]![0] as Record<
      string,
      unknown
    >
    expect(approveBody.status).toBe('ACTIVE')

    // Edit body carries status ACTIVE
    const editBody = createDatasetItem.mock.calls[1]![0] as Record<
      string,
      unknown
    >
    expect(editBody.status).toBe('ACTIVE')
  })
})

// ---------------------------------------------------------------------------
// prelabelItem
// ---------------------------------------------------------------------------

describe('prelabelItem', () => {
  const productsSchema = z.object({
    decisions: z.array(
      z.object({
        candidateUrl: z.string(),
        selected: z.boolean(),
        approvedBand: z.string().optional(),
        relativeRank: z.number().optional(),
      }),
    ),
  })

  it('upserts expectedOutput + prelabel + boundaryTags on the stable id, keeps ARCHIVED + pending, rejects absent candidateUrl', async () => {
    const existingItem = {
      id: 'item-1',
      status: 'ARCHIVED',
      input: {
        pool: [
          { url: 'https://shop.com/a', title: 'A' },
          { url: 'https://shop.com/b', title: 'B' },
        ],
      },
      expectedOutput: null,
      metadata: { someExisting: true },
    }

    const createDatasetItem = vi.fn().mockResolvedValue({})

    await prelabelItem(
      {
        dataset: 'products-editorial-score-golden',
        itemId: 'item-1',
        expectedOutput: {
          decisions: [
            { candidateUrl: 'https://shop.com/a', selected: true },
          ],
        },
        prelabel: {
          author: 'system',
          method: 'readPage',
          status: 'draft',
          rationale: 'auto',
        },
        boundaryTags: ['niche'],
      },
      {
        getDataset: vi.fn().mockResolvedValue({ items: [existingItem] }),
        createDatasetItem,
        adapterFor: vi.fn().mockReturnValue({ expectedSchema: productsSchema }),
      },
    )

    expect(createDatasetItem).toHaveBeenCalledTimes(1)
    const body = createDatasetItem.mock.calls[0]![0] as Record<
      string,
      unknown
    >

    expect(body.id).toBe('item-1')
    expect(body.status).toBe('ARCHIVED')
    expect(body.expectedOutput).toEqual({
      decisions: [{ candidateUrl: 'https://shop.com/a', selected: true }],
    })

    const meta = body.metadata as Record<string, unknown>
    expect(meta.prelabel).toEqual({
      author: 'system',
      method: 'readPage',
      status: 'draft',
      rationale: 'auto',
    })
    expect(meta.boundaryTags).toEqual(['niche'])
    expect(meta.humanApproval).toEqual({ status: 'pending' })
    // Preserves existing metadata
    expect(meta.someExisting).toBe(true)

    // --- Part 2: rejects absent candidateUrl ---
    await expect(
      prelabelItem(
        {
          dataset: 'products-editorial-score-golden',
          itemId: 'item-1',
          expectedOutput: {
            decisions: [
              { candidateUrl: 'https://shop.com/MISSING', selected: false },
            ],
          },
          prelabel: { author: 'system', method: 'readPage', status: 'draft' },
          boundaryTags: [],
        },
        {
          getDataset: vi.fn().mockResolvedValue({ items: [existingItem] }),
          createDatasetItem: vi.fn().mockResolvedValue({}),
          adapterFor: vi
            .fn()
            .mockReturnValue({ expectedSchema: productsSchema }),
        },
      ),
    ).rejects.toThrow(/MISSING/)
  })
})
