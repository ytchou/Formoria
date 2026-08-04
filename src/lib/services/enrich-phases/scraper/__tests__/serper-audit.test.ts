import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { batchSearchBrandImages, searchBrandMaps } from '../search'
import { startSearchAudit } from '@/lib/services/search-results'
import {
  resetAuditEmitterForTests,
  setAuditWriteSeam,
  type AuditRecord,
} from '@/lib/audit'

vi.mock('@/lib/adapters/alerting/sentry', () => ({ captureAlert: vi.fn(() => true) }))

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

const auditOptions = (state: AuditState, overrides: Record<string, unknown> = {}) => ({
  target: { type: 'submission' as const, id: 'submission-1' },
  supabase: auditClient(state) as never,
  ...overrides,
})

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

  it('audits Maps requests and responses without placing credentials in the request input', async () => {
    const state: AuditState = { inserts: [], updates: [] }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            places: [
              {
                title: 'Littdlework 永康旗艦店',
                address: '臺北市大安區永康街 1 號',
                latitude: 25.033,
                longitude: 121.565,
                website: 'https://littdlework.example/stores',
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    )

    const result = await searchBrandMaps('Littdlework 永康旗艦店', auditOptions(state, { dryRun: true }))

    expect(result.places).toHaveLength(1)
    expect(state.inserts.at(0)).toMatchObject({
      provider: 'serper',
      endpoint: 'https://google.serper.dev/maps',
      call_status: 'started',
      input: { q: 'Littdlework 永康旗艦店' },
      config: { dryRun: true },
    })
    expect(JSON.stringify(state.inserts.at(0))).not.toContain('secret-api-key')
    expect(state.updates.at(0)).toMatchObject({
      call_status: 'succeeded',
      http_status: 200,
      raw_response: expect.objectContaining({ places: expect.any(Array) }),
      urls: ['https://littdlework.example/stores'],
    })
  })

  it('serper call writes one audit span and one deep-store row sharing a span_id', async () => {
    const state: AuditState = { inserts: [], updates: [] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ places: [{ title: 'Recovered' }] }), { status: 200 })))

    await searchBrandMaps('Recovered', auditOptions(state))

    expect(writes).toHaveLength(2)
    expect(writes[0]?.status).toBe('started')
    expect(writes[1]?.status).toBe('succeeded')
    expect(writes[0]?.spanId).toBe(writes[1]?.spanId)
    expect(state.inserts[0]?.audit_span_id).toBe(writes[0]?.spanId)
  })

  it('deep-store write still succeeds when the audit write fails', async () => {
    // A code-bearing, non-transient write error: classifyPostgrestError treats a
    // codeless error as retryable, which would burn real backoff sleeps here.
    setAuditWriteSeam(async () => ({ code: '23505', message: 'audit sink unavailable' }))
    const state: AuditState = { inserts: [], updates: [] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ places: [{ title: 'Recovered' }] }), { status: 200 })))

    await expect(searchBrandMaps('Recovered', auditOptions(state))).resolves.toMatchObject({ callStatus: 'succeeded' })

    expect(state.inserts).toHaveLength(1)
    expect(state.updates).toHaveLength(1)
  })

  it('existing brand_search_results payload shape is unchanged', async () => {
    const state: AuditState = { inserts: [], updates: [] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ places: [] }), { status: 200 })))

    await searchBrandMaps('No results', auditOptions(state))

    expect(Object.keys(state.inserts[0] ?? {}).sort()).toEqual([
      'audit_span_id',
      'attempt',
      'brand_id',
      'call_status',
      'config',
      'endpoint',
      'error',
      'http_status',
      'input',
      'job_id',
      'latency_ms',
      'provider',
      'query',
      'raw_response',
      'retry_attempt',
      'search_type',
      'snippets',
      'submission_id',
      'urls',
    ].sort())
  })

  it("a timeout produces status='timeout' on the finish row", async () => {
    vi.useFakeTimers()
    const state: AuditState = { inserts: [], updates: [] }
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: unknown, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
            })
          }),
      ),
    )

    const pending = searchBrandMaps('Timeout', auditOptions(state))
    await vi.runAllTimersAsync()
    const result = await pending

    expect(result.callStatus).toBe('timeout')
    expect(writes.some((record) => record.status === 'timeout')).toBe(true)
    expect(state.updates.at(0)).toMatchObject({ call_status: 'timeout' })
  })

  it('does not turn blank Maps coordinates into zeroes', async () => {
    const state: AuditState = { inserts: [], updates: [] }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            places: [
              {
                title: 'Unpinned place',
                address: '臺北市某路 1 號',
                latitude: '',
                longitude: '',
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    )

    const result = await searchBrandMaps('Unpinned place', auditOptions(state))

    expect(result.places[0]).not.toHaveProperty('latitude')
    expect(result.places[0]).not.toHaveProperty('longitude')
  })

  it.each([
    ['empty', new Response(JSON.stringify({ places: [] }), { status: 200 }), 'empty'],
    [
      'non-2xx',
      new Response(JSON.stringify({ message: 'rate limited' }), {
        status: 429,
      }),
      'failed',
    ],
    ['malformed', new Response('{', { status: 200 }), 'malformed'],
  ])('finalizes %s outcomes', async (_label, response, expectedStatus) => {
    const state: AuditState = { inserts: [], updates: [] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

    await searchBrandMaps('test', auditOptions(state))

    expect(state.updates.at(0)).toMatchObject({ call_status: expectedStatus })
  })

  it('audits malformed result arrays as malformed instead of network failures', async () => {
    const state: AuditState = { inserts: [], updates: [] }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ places: [null] }), { status: 200 }),
      ),
    )

    await searchBrandMaps('test', auditOptions(state))

    expect(state.updates.at(0)).toMatchObject({
      call_status: 'malformed',
      http_status: 200,
      raw_response: { places: [null] },
    })
  })

  it('finalizes network failures and stops before fetch when the audit insert fails', async () => {
    const networkState: AuditState = { inserts: [], updates: [] }
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket failure')))
    await searchBrandMaps('test', auditOptions(networkState))
    expect(networkState.updates.at(0)).toMatchObject({
      call_status: 'network_error',
    })

    const failedState: AuditState = { inserts: [], updates: [] }
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      searchBrandMaps('test', {
        target: { type: 'submission', id: 'submission-1' },
        supabase: auditClient(failedState, new Error('audit unavailable')) as never,
      }),
    ).rejects.toThrow('Failed to start')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retries a network error and succeeds', async () => {
    const state: AuditState = { inserts: [], updates: [] }
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValue(new Response(JSON.stringify({ places: [{ title: 'Recovered' }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await withFakeTimers(() => searchBrandMaps('Recovered', auditOptions(state)))

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.callStatus).toBe('succeeded')
  })

  it('retries a timeout instead of returning the first timeout', async () => {
    const state: AuditState = { inserts: [], updates: [] }
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      .mockResolvedValue(new Response(JSON.stringify({ places: [{ title: 'Recovered' }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await withFakeTimers(() => searchBrandMaps('Recovered', auditOptions(state)))

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.callStatus).toBe('succeeded')
  })

  it('retries both rate limits and server errors', async () => {
    const state: AuditState = { inserts: [], updates: [] }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValue(new Response(JSON.stringify({ places: [{ title: 'Recovered' }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await withFakeTimers(() => searchBrandMaps('Recovered', auditOptions(state)))

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.callStatus).toBe('succeeded')
  })

  it('gives up after three attempts and reports the real failure', async () => {
    const state: AuditState = { inserts: [], updates: [] }
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await withFakeTimers(() => searchBrandMaps('Unavailable', auditOptions(state)))

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.callStatus).toBe('network_error')
  })

  it('writes one audit pair per retry with distinct retry_attempt values', async () => {
    const state: AuditState = { inserts: [], updates: [] }
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 429 }))
        .mockResolvedValueOnce(new Response(null, { status: 429 }))
        .mockResolvedValue(new Response(JSON.stringify({ places: [{ title: 'Recovered' }] }), { status: 200 })),
    )

    await withFakeTimers(() => searchBrandMaps('Recovered', auditOptions(state, { attempt: 7 })))

    expect(state.inserts).toHaveLength(3)
    expect(state.inserts.map((row) => row.retry_attempt)).toEqual([0, 1, 2])
    expect(state.inserts.map((row) => row.attempt)).toEqual([7, 7, 7])
    expect(state.updates).toHaveLength(3)
  })

  it('finalizes an aborted request as a timeout', async () => {
    vi.useFakeTimers()
    const state: AuditState = { inserts: [], updates: [] }
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: unknown, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
            })
          }),
      ),
    )

    const pending = searchBrandMaps('test', auditOptions(state))
    await vi.runAllTimersAsync()
    const result = await pending

    expect(result.callStatus).toBe('timeout')
    expect(state.updates.at(0)).toMatchObject({ call_status: 'timeout' })
  })

  it('records each image query variant as its own audit attempt', async () => {
    const state: AuditState = { inserts: [], updates: [] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ images: [] }), { status: 200 })))

    await batchSearchBrandImages(
      [
        {
          brandName: 'Littdlework',
          productType: 'home',
        },
      ],
      1,
      undefined,
      () => auditOptions(state),
    )

    expect(state.inserts).toHaveLength(1)
    expect(state.inserts.at(0)).toMatchObject({
      search_type: 'image',
      attempt: 1,
      config: { queryVariant: 1 },
    })
    expect(state.updates.at(0)).toMatchObject({ call_status: 'empty' })
  })

  it('leaves a newly created call visibly started until it is finalized', async () => {
    const state: AuditState = { inserts: [], updates: [] }
    await startSearchAudit({
      ...auditOptions(state),
      provider: 'serper',
      endpoint: 'https://google.serper.dev/maps',
      searchType: 'maps',
      query: 'test',
      input: { q: 'test' },
    })

    expect(state.inserts.at(0)?.call_status).toBe('started')
    expect(state.updates).toHaveLength(0)
  })
})
