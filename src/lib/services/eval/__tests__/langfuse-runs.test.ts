import { describe, expect, it, vi } from 'vitest'
import {
  runName,
  traceName,
  writeItemScores,
  findQueueByName,
  enqueueTrace,
} from '../langfuse-runs'

describe('runName and traceName follow the naming decision', () => {
  it('runName is ${dataset}:${arm}:${iso}', () => {
    expect(runName('detect-golden', 'gpt-5.6', '2026-09-04T00:00:00.000Z'))
      .toBe('detect-golden:gpt-5.6:2026-09-04T00:00:00.000Z')
  })

  it('traceName is eval:${dataset}:${arm}:${itemId}', () => {
    expect(traceName('detect-golden', 'gpt-5.6', 'item-abc'))
      .toBe('eval:detect-golden:gpt-5.6:item-abc')
  })
})

describe('writeItemScores', () => {
  it('emits one score per evaluator on the trace id', async () => {
    const scoreFn = vi.fn<(params: Record<string, unknown>) => void>()

    const scores = [
      { name: 'decisionAgreement', value: 1 },
      { name: 'confidenceBand', value: 0.5 },
      { name: 'writeEligible', value: 0 },
    ]

    await writeItemScores({
      traceId: 'trace-123',
      scores,
      scoreFn,
    })

    expect(scoreFn).toHaveBeenCalledTimes(3)

    expect(scoreFn).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'trace-123',
        name: 'decisionAgreement',
        value: 1,
      }),
    )
    expect(scoreFn).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'trace-123',
        name: 'confidenceBand',
        value: 0.5,
      }),
    )
    expect(scoreFn).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'trace-123',
        name: 'writeEligible',
        value: 0,
      }),
    )
  })
})

describe('findQueueByName', () => {
  it('returns the id when the queue exists', async () => {
    const listFn = vi.fn().mockResolvedValue({
      data: [
        { id: 'q-1', name: 'eval-review' },
        { id: 'q-2', name: 'prod-review' },
      ],
    })

    const id = await findQueueByName({ name: 'eval-review', listFn })
    expect(id).toBe('q-1')
  })

  it('throws listing available names when not found', async () => {
    const listFn = vi.fn().mockResolvedValue({
      data: [
        { id: 'q-1', name: 'eval-review' },
        { id: 'q-2', name: 'prod-review' },
      ],
    })

    await expect(findQueueByName({ name: 'missing', listFn })).rejects.toThrow(
      /missing.*eval-review.*prod-review/,
    )
  })
})

describe('enqueueTrace', () => {
  it('posts {objectId, objectType: TRACE}', async () => {
    const createFn = vi.fn().mockResolvedValue({ id: 'item-1' })

    await enqueueTrace({
      queueId: 'q-1',
      traceId: 'trace-abc',
      createFn,
    })

    expect(createFn).toHaveBeenCalledTimes(1)
    expect(createFn).toHaveBeenCalledWith('q-1', {
      objectId: 'trace-abc',
      objectType: 'TRACE',
    })
  })
})
