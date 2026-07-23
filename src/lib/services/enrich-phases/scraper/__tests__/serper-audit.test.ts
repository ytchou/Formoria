import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { batchSearchBrandImages, searchBrandMaps } from '../search'
import { startSearchAudit } from '@/lib/services/search-results'

type AuditState = {
  inserts: Array<Record<string, unknown>>
  updates: Array<Record<string, unknown>>
}

function auditClient(state: AuditState, insertError?: Error) {
  return {
    from: (table: string) => {
      if (table !== 'brand_search_results') throw new Error(`Unexpected table ${table}`)
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

const auditOptions = (state: AuditState, overrides: Record<string, unknown> = {}) => ({
  target: { type: 'submission' as const, id: 'submission-1' },
  supabase: auditClient(state) as never,
  ...overrides,
})

describe('audited Serper adapter', () => {
  beforeEach(() => {
    process.env.SERPER_API_KEY = 'secret-api-key'
  })

  afterEach(() => {
    delete process.env.SERPER_API_KEY
    vi.unstubAllGlobals()
    vi.useRealTimers()
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
    await vi.advanceTimersByTimeAsync(60_000)
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
          purchaseWebsite: 'https://littdlework.example',
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
