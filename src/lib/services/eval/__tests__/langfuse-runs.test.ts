import { describe, expect, it, vi } from 'vitest'
import {
  runName,
  traceName,
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
