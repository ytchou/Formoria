import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { batchSearchBrandImages } from '../search'
import {
  resetAuditEmitterForTests,
  setAuditWriteSeam,
  type AuditRecord,
} from '@/lib/audit'

vi.mock('@/lib/adapters/alerting/sentry', () => ({
  captureAlert: vi.fn(() => true),
}))

type AuditState = {
  inserts: Array<Record<string, unknown>>
  updates: Array<Record<string, unknown>>
}

function auditClient(state: AuditState, insertError?: Error) {
  return {
    from: (table: string) => {
      if (table !== 'brand_search_results' && table !== 'external_call_audit') {
        throw new Error(`Unexpected table ${table}`)
      }
      return {
        insert: (payload: Record<string, unknown>) => {
          state.inserts.push(payload)
          return {
            select: () => ({
              single: async () =>
                insertError
                  ? { data: null, error: insertError }
                  : {
                      data: { id: `audit-${state.inserts.length}` },
                      error: null,
                    },
            }),
          }
        },
        update: (payload: Record<string, unknown>) => {
          state.updates.push(payload)
          return { eq: async () => ({ error: null }) }
        },
      }
    },
  }
}

let writes: AuditRecord[]

const auditOptions = (
  state: AuditState,
  overrides: Record<string, unknown> = {},
) => ({
  target: { type: 'submission' as const, id: 'submission-1' },
  supabase: auditClient(state) as never,
  ...overrides,
})

async function searchImages(state: AuditState) {
  return batchSearchBrandImages(['Littdlework'], 1, undefined, () =>
    auditOptions(state),
  )
}

async function withFakeTimers<T>(run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers()
  const promise = run()
  await vi.runAllTimersAsync()
  return promise
}

describe('audited Serper adapter', () => {
  beforeEach(() => {
    process.env.SERPER_API_KEY = 'secret-api-key'
    writes = []
    setAuditWriteSeam(async (record) => {
      writes.push(record)
      return null
    })
  })

  afterEach(() => {
    delete process.env.SERPER_API_KEY
    vi.unstubAllGlobals()
    vi.useRealTimers()
    resetAuditEmitterForTests()
  })

  it('audits image requests and responses without placing credentials in the request input', async () => {
    const state: AuditState = { inserts: [], updates: [] }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            images: [
              {
                imageUrl: 'https://images.example/product.jpg',
                imageWidth: 800,
                imageHeight: 600,
                link: 'https://littdlework.example/products',
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    )

    const result = await searchImages(state)

    expect(result.get('Littdlework')?.rows).toHaveLength(1)
    expect(state.inserts.at(0)).toMatchObject({
      provider: 'serper',
      endpoint: 'https://google.serper.dev/images',
      search_type: 'image',
      call_status: 'started',
    })
    expect(JSON.stringify(state.inserts.at(0))).not.toContain('secret-api-key')
    expect(state.updates.at(0)).toMatchObject({
      call_status: 'succeeded',
      http_status: 200,
      urls: ['https://images.example/product.jpg'],
    })
    expect(writes.map((record) => record.status)).toEqual([
      'started',
      'succeeded',
    ])
  })

  it('retries a network error and preserves one audit pair per attempt', async () => {
    const state: AuditState = { inserts: [], updates: [] }
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValue(
        new Response(JSON.stringify({ images: [] }), { status: 200 }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await withFakeTimers(() => searchImages(state))

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.get('Littdlework')?.callStatus).toBe('empty')
    expect(state.inserts.map((row) => row.retry_attempt)).toEqual([0, 1])
    expect(state.updates).toHaveLength(2)
  })

  it('finalizes an exhausted timeout as a timeout', async () => {
    const state: AuditState = { inserts: [], updates: [] }
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: unknown, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              reject(
                Object.assign(new Error('aborted'), { name: 'AbortError' }),
              )
            })
          }),
      ),
    )

    const result = await withFakeTimers(() => searchImages(state))

    expect(result.get('Littdlework')?.callStatus).toBe('timeout')
    expect(state.updates.at(-1)).toMatchObject({ call_status: 'timeout' })
  })

  it('classifies malformed image arrays as malformed', async () => {
    const state: AuditState = { inserts: [], updates: [] }
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ images: [null] }), { status: 200 }),
        ),
    )

    const result = await searchImages(state)

    expect(result.get('Littdlework')?.callStatus).toBe('malformed')
    expect(state.updates.at(0)).toMatchObject({
      call_status: 'malformed',
      raw_response: { images: [null] },
    })
  })
})
