import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dispatchCurationJob } from '../curation-dispatch'

describe('dispatchCurationJob', () => {
  const originalUrl = process.env.CURATION_WORKER_URL
  const originalToken = process.env.CURATION_WORKER_CONTROL_TOKEN

  beforeEach(() => {
    process.env.CURATION_WORKER_URL = 'https://worker.example.com/'
    process.env.CURATION_WORKER_CONTROL_TOKEN = 'worker-control-secret'
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalUrl === undefined) delete process.env.CURATION_WORKER_URL
    else process.env.CURATION_WORKER_URL = originalUrl
    if (originalToken === undefined) delete process.env.CURATION_WORKER_CONTROL_TOKEN
    else process.env.CURATION_WORKER_CONTROL_TOKEN = originalToken
  })

  it('accepts an authenticated worker-control response without waiting for the job', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ accepted: true, status: 'started' }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(dispatchCurationJob('550e8400-e29b-41d4-a716-446655440000')).resolves.toEqual({
      accepted: true,
      status: 'started',
    })

    expect(fetch).toHaveBeenCalledWith(
      'https://worker.example.com/run',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ jobId: '550e8400-e29b-41d4-a716-446655440000' }),
        headers: expect.objectContaining({
          authorization: 'Bearer worker-control-secret',
        }),
      }),
    )
  })

  it('returns a sanitized dispatch error for a rejected worker request', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({
        error: 'Bearer provider-secret; postgresql://worker:db-password@db.example.com/formoria',
      }), {
        status: 503,
      }),
    )

    await expect(
      dispatchCurationJob('550e8400-e29b-41d4-a716-446655440000'),
    ).rejects.toThrow(
      'Worker dispatch was rejected: Bearer [REDACTED]; postgresql://worker:[REDACTED]@db.example.com/formoria',
    )
  })

  it('fails clearly when the worker endpoint is not configured', async () => {
    delete process.env.CURATION_WORKER_URL

    await expect(dispatchCurationJob('550e8400-e29b-41d4-a716-446655440000')).rejects.toThrow(
      'CURATION_WORKER_URL and CURATION_WORKER_CONTROL_TOKEN are required',
    )
  })
})
