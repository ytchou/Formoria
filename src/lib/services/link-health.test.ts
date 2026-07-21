import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}))

import { createServiceClient } from '@/lib/supabase/server'
import { checkUrl, runLinkHealthCheck } from './link-health'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type BrandRow = {
  id: string
  purchase_website: string | null
  purchase_pinkoi: string | null
  purchase_shopee: string | null
  hero_image_url: string | null
}

type LinkCheckRow = {
  id: string
  brand_id: string
  field: string
  url: string
  consecutive_failures: number
  last_ok_at: string | null
  auto_nulled_at: string | null
}

function makeSupabaseMock(brands: BrandRow[], existingRows: LinkCheckRow[] = []) {
  const brandsUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const brandsUpdateFn = vi.fn().mockReturnValue({ eq: brandsUpdateEq })

  const linkSelectIn = vi.fn().mockResolvedValue({ data: existingRows, error: null })
  const linkSelectFn = vi.fn().mockReturnValue({ in: linkSelectIn })

  const linkUpsertFn = vi.fn().mockResolvedValue({ error: null })

  const linkUpdateEq2 = vi.fn().mockResolvedValue({ error: null })
  const linkUpdateEq1 = vi.fn().mockReturnValue({ eq: linkUpdateEq2 })
  const linkUpdateFn = vi.fn().mockReturnValue({ eq: linkUpdateEq1 })

  const linkDeleteIn = vi.fn().mockResolvedValue({ error: null })
  const linkDeleteFn = vi.fn().mockReturnValue({ in: linkDeleteIn })

  const brandsMock = {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: brands, error: null }),
    }),
    update: brandsUpdateFn,
  }

  const linkCheckMock = {
    select: linkSelectFn,
    upsert: linkUpsertFn,
    update: linkUpdateFn,
    delete: linkDeleteFn,
  }

  const client = {
    from: vi.fn((table: string) => {
      if (table === 'brands') return brandsMock
      if (table === 'link_check_results') return linkCheckMock
      return {}
    }),
  }

  return {
    client,
    spies: {
      brandsUpdateFn,
      brandsUpdateEq,
      linkUpsertFn,
      linkUpdateFn,
      linkUpdateEq1,
      linkUpdateEq2,
      linkDeleteFn,
      linkDeleteIn,
    },
  }
}

const okFetch: typeof fetch = () =>
  Promise.resolve({ status: 200, ok: true } as unknown as Response)

const silentDeliver: typeof fetch = () =>
  Promise.resolve({
    status: 200,
    ok: true,
    text: async () => JSON.stringify({ run_id: 'r1', duplicate: false }),
  } as unknown as Response)

// ---------------------------------------------------------------------------
// checkUrl — pure URL checking logic
// ---------------------------------------------------------------------------

describe('checkUrl', () => {
  it('returns ok for 200', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 200, ok: true })
    const result = await checkUrl('https://example.com', mockFetch)
    expect(result.status).toBe('ok')
    expect(result.statusCode).toBe(200)
  })

  it('returns ok for 301 redirect', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 301, ok: false })
    const result = await checkUrl('https://example.com', mockFetch)
    expect(result.status).toBe('ok')
    expect(result.statusCode).toBe(301)
  })

  it('returns broken for 404', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 404, ok: false })
    const result = await checkUrl('https://example.com', mockFetch)
    expect(result.status).toBe('broken')
    expect(result.statusCode).toBe(404)
  })

  it('returns broken for 410', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 410, ok: false })
    const result = await checkUrl('https://example.com', mockFetch)
    expect(result.status).toBe('broken')
  })

  it('returns broken for 500', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 500, ok: false })
    const result = await checkUrl('https://example.com', mockFetch)
    expect(result.status).toBe('broken')
  })

  it('returns broken on network error', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    const result = await checkUrl('https://example.com', mockFetch)
    expect(result.status).toBe('broken')
    expect(result.statusCode).toBeNull()
  })

  it('returns blocked for 429 from HEAD (no GET retry)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 429, ok: false })
    const result = await checkUrl('https://example.com', mockFetch)
    expect(result.status).toBe('blocked')
    // Should not have retried with GET
    expect(mockFetch).toHaveBeenCalledOnce()
  })

  it('retries with GET on 405, returns ok if GET succeeds', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ status: 405, ok: false })   // HEAD
      .mockResolvedValueOnce({ status: 200, ok: true })    // GET
    const result = await checkUrl('https://example.com', mockFetch)
    expect(result.status).toBe('ok')
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch.mock.calls[1][1]).toMatchObject({ method: 'GET' })
  })

  it('retries with GET on 403, returns blocked if GET also returns 403', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ status: 403, ok: false })   // HEAD
      .mockResolvedValueOnce({ status: 403, ok: false })   // GET
    const result = await checkUrl('https://example.com', mockFetch)
    expect(result.status).toBe('blocked')
  })

  it('retries with GET on 403, returns blocked if GET returns 429', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ status: 403, ok: false })   // HEAD
      .mockResolvedValueOnce({ status: 429, ok: false })   // GET
    const result = await checkUrl('https://example.com', mockFetch)
    expect(result.status).toBe('blocked')
  })

  it('retries with GET on 501, returns broken if GET returns 500', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ status: 501, ok: false })   // HEAD
      .mockResolvedValueOnce({ status: 500, ok: false })   // GET
    const result = await checkUrl('https://example.com', mockFetch)
    expect(result.status).toBe('broken')
  })

  it('retries with GET on 403, returns broken if GET network fails', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ status: 403, ok: false })
      .mockRejectedValueOnce(new TypeError('network error'))
    const result = await checkUrl('https://example.com', mockFetch)
    expect(result.status).toBe('broken')
  })
})

// ---------------------------------------------------------------------------
// runLinkHealthCheck — full orchestration
// ---------------------------------------------------------------------------

describe('runLinkHealthCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://xkcayngbttpxyibgzern.supabase.co')
    vi.stubEnv('AGENT_HUB_INGEST_URL', 'https://hub.example.com/ingest')
    vi.stubEnv('AGENT_HUB_INGEST_TOKEN', 'test-token')
  })

  it('increments consecutive_failures on broken', async () => {
    const brand: BrandRow = { id: 'b1', purchase_website: 'https://example.com', purchase_pinkoi: null, purchase_shopee: null, hero_image_url: null }
    const existing: LinkCheckRow = { id: 'r1', brand_id: 'b1', field: 'purchase_website', url: 'https://example.com', consecutive_failures: 1, last_ok_at: null, auto_nulled_at: null }
    const { client, spies } = makeSupabaseMock([brand], [existing])
    vi.mocked(createServiceClient).mockReturnValue(client as never)

    const brokenFetch = vi.fn()
      .mockResolvedValue({ status: 500, ok: false } as Response)

    await runLinkHealthCheck({ fetchFn: brokenFetch, deliverFn: silentDeliver })

    expect(spies.linkUpsertFn).toHaveBeenCalled()
    const upsertArg = spies.linkUpsertFn.mock.calls[0][0] as { consecutive_failures: number }[]
    const row = upsertArg.find((r) => r.consecutive_failures !== undefined)
    expect(row?.consecutive_failures).toBe(2)
  })

  it('resets consecutive_failures to 0 on ok and sets last_ok_at', async () => {
    const brand: BrandRow = { id: 'b1', purchase_website: 'https://example.com', purchase_pinkoi: null, purchase_shopee: null, hero_image_url: null }
    const existing: LinkCheckRow = { id: 'r1', brand_id: 'b1', field: 'purchase_website', url: 'https://example.com', consecutive_failures: 2, last_ok_at: null, auto_nulled_at: null }
    const { client, spies } = makeSupabaseMock([brand], [existing])
    vi.mocked(createServiceClient).mockReturnValue(client as never)

    await runLinkHealthCheck({ fetchFn: okFetch, deliverFn: silentDeliver })

    const upsertArg = spies.linkUpsertFn.mock.calls[0][0] as { consecutive_failures: number; last_ok_at: string | null }[]
    const row = upsertArg[0]
    expect(row.consecutive_failures).toBe(0)
    expect(row.last_ok_at).not.toBeNull()
  })

  it('auto-nulls purchase field at consecutive_failures >= 3 and stamps auto_nulled_at on the row', async () => {
    const brand: BrandRow = { id: 'b1', purchase_website: 'https://example.com', purchase_pinkoi: null, purchase_shopee: null, hero_image_url: null }
    // Already at 2 failures; this run makes it 3
    const existing: LinkCheckRow = { id: 'r1', brand_id: 'b1', field: 'purchase_website', url: 'https://example.com', consecutive_failures: 2, last_ok_at: null, auto_nulled_at: null }
    const { client, spies } = makeSupabaseMock([brand], [existing])
    vi.mocked(createServiceClient).mockReturnValue(client as never)

    const brokenFetch = vi.fn().mockResolvedValue({ status: 500, ok: false } as Response)

    const result = await runLinkHealthCheck({ fetchFn: brokenFetch, deliverFn: silentDeliver })

    // brands.update called with null for purchase_website
    expect(spies.brandsUpdateFn).toHaveBeenCalledWith({ purchase_website: null })
    // link_check_results.update called to stamp auto_nulled_at
    expect(spies.linkUpdateFn).toHaveBeenCalledWith(expect.objectContaining({ auto_nulled_at: expect.any(String) }))
    // summary reports the auto-null
    expect(result.autoNulled).toHaveLength(1)
    expect(result.autoNulled[0]).toMatchObject({ brandId: 'b1', field: 'purchase_website', url: 'https://example.com' })
  })

  it('retains link_check_results row (with url) after auto-null', async () => {
    const brand: BrandRow = { id: 'b1', purchase_website: 'https://example.com', purchase_pinkoi: null, purchase_shopee: null, hero_image_url: null }
    const existing: LinkCheckRow = { id: 'r1', brand_id: 'b1', field: 'purchase_website', url: 'https://example.com', consecutive_failures: 2, last_ok_at: null, auto_nulled_at: null }
    const { client, spies } = makeSupabaseMock([brand], [existing])
    vi.mocked(createServiceClient).mockReturnValue(client as never)

    const brokenFetch = vi.fn().mockResolvedValue({ status: 500, ok: false } as Response)

    await runLinkHealthCheck({ fetchFn: brokenFetch, deliverFn: silentDeliver })

    // The upsert row still has the url (row is kept)
    const upsertArg = spies.linkUpsertFn.mock.calls[0][0] as { url: string }[]
    expect(upsertArg.some((r) => r.url === 'https://example.com')).toBe(true)
    // delete was NOT called for this row
    expect(spies.linkDeleteIn).not.toHaveBeenCalledWith('id', ['r1'])
  })

  it('does NOT null hero_image_url when broken; adds to heroBroken (Supabase storage)', async () => {
    const heroUrl = 'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/foo.jpg'
    const brand: BrandRow = { id: 'b1', purchase_website: null, purchase_pinkoi: null, purchase_shopee: null, hero_image_url: heroUrl }
    const { client, spies } = makeSupabaseMock([brand], [])
    vi.mocked(createServiceClient).mockReturnValue(client as never)

    const brokenFetch = vi.fn().mockResolvedValue({ status: 404, ok: false } as Response)

    const result = await runLinkHealthCheck({ fetchFn: brokenFetch, deliverFn: silentDeliver })

    // brands.update must NOT be called for hero
    expect(spies.brandsUpdateFn).not.toHaveBeenCalledWith({ hero_image_url: null })
    expect(result.heroBroken).toHaveLength(1)
    expect(result.heroBroken[0]).toMatchObject({ brandId: 'b1', url: heroUrl })
    expect(result.autoNulled).toHaveLength(0)
  })

  it('adds to heroExternal when hero URL is broken and NOT on Supabase storage', async () => {
    const heroUrl = 'https://cdn.external.com/images/hero.jpg'
    const brand: BrandRow = { id: 'b1', purchase_website: null, purchase_pinkoi: null, purchase_shopee: null, hero_image_url: heroUrl }
    const { client } = makeSupabaseMock([brand], [])
    vi.mocked(createServiceClient).mockReturnValue(client as never)

    const brokenFetch = vi.fn().mockResolvedValue({ status: 404, ok: false } as Response)

    const result = await runLinkHealthCheck({ fetchFn: brokenFetch, deliverFn: silentDeliver })

    expect(result.heroExternal).toHaveLength(1)
    expect(result.heroExternal[0]).toMatchObject({ brandId: 'b1', url: heroUrl })
    expect(result.heroBroken).toHaveLength(0)
  })

  it('does NOT increment counter for blocked status (403/429 after GET)', async () => {
    const brand: BrandRow = { id: 'b1', purchase_website: 'https://shopee.tw/brand', purchase_pinkoi: null, purchase_shopee: null, hero_image_url: null }
    const existing: LinkCheckRow = { id: 'r1', brand_id: 'b1', field: 'purchase_website', url: 'https://shopee.tw/brand', consecutive_failures: 1, last_ok_at: null, auto_nulled_at: null }
    const { client, spies } = makeSupabaseMock([brand], [existing])
    vi.mocked(createServiceClient).mockReturnValue(client as never)

    // HEAD → 403, GET → 403 (WAF-blocked)
    const blockedFetch = vi.fn()
      .mockResolvedValueOnce({ status: 403, ok: false } as Response)
      .mockResolvedValueOnce({ status: 403, ok: false } as Response)

    await runLinkHealthCheck({ fetchFn: blockedFetch, deliverFn: silentDeliver })

    const upsertArg = spies.linkUpsertFn.mock.calls[0][0] as { consecutive_failures: number }[]
    expect(upsertArg[0].consecutive_failures).toBe(1) // unchanged
  })

  it('does not auto-null when blocked (even if row consecutive_failures would be >= 3)', async () => {
    const brand: BrandRow = { id: 'b1', purchase_website: 'https://shopee.tw/brand', purchase_pinkoi: null, purchase_shopee: null, hero_image_url: null }
    const existing: LinkCheckRow = { id: 'r1', brand_id: 'b1', field: 'purchase_website', url: 'https://shopee.tw/brand', consecutive_failures: 5, last_ok_at: null, auto_nulled_at: null }
    const { client, spies } = makeSupabaseMock([brand], [existing])
    vi.mocked(createServiceClient).mockReturnValue(client as never)

    const blockedFetch = vi.fn()
      .mockResolvedValueOnce({ status: 403, ok: false } as Response)
      .mockResolvedValueOnce({ status: 403, ok: false } as Response)

    const result = await runLinkHealthCheck({ fetchFn: blockedFetch, deliverFn: silentDeliver })

    expect(spies.brandsUpdateFn).not.toHaveBeenCalled()
    expect(result.autoNulled).toHaveLength(0)
  })

  it('deletes stale rows when brand URL is cleared', async () => {
    // Brand no longer has purchase_website but a stale row exists
    const brand: BrandRow = { id: 'b1', purchase_website: null, purchase_pinkoi: null, purchase_shopee: null, hero_image_url: null }
    const existing: LinkCheckRow = { id: 'r1', brand_id: 'b1', field: 'purchase_website', url: 'https://old.com', consecutive_failures: 1, last_ok_at: null, auto_nulled_at: null }
    const { client, spies } = makeSupabaseMock([brand], [existing])
    vi.mocked(createServiceClient).mockReturnValue(client as never)

    await runLinkHealthCheck({ fetchFn: okFetch, deliverFn: silentDeliver })

    expect(spies.linkDeleteIn).toHaveBeenCalledWith('id', ['r1'])
  })

  it('does NOT delete auto-nulled audit rows even though the brand field is null', async () => {
    // Post-auto-null state: brand field cleared, audit row retained with auto_nulled_at
    const brand: BrandRow = { id: 'b1', purchase_website: null, purchase_pinkoi: null, purchase_shopee: null, hero_image_url: null }
    const existing: LinkCheckRow = { id: 'r1', brand_id: 'b1', field: 'purchase_website', url: 'https://dead.example.com', consecutive_failures: 3, last_ok_at: null, auto_nulled_at: '2026-07-20T00:00:00Z' }
    const { client, spies } = makeSupabaseMock([brand], [existing])
    vi.mocked(createServiceClient).mockReturnValue(client as never)

    await runLinkHealthCheck({ fetchFn: okFetch, deliverFn: silentDeliver })

    expect(spies.linkDeleteIn).not.toHaveBeenCalled()
  })

  it('does not stamp auto_nulled_at when the brands.update fails (retry next run)', async () => {
    const brand: BrandRow = { id: 'b1', purchase_website: 'https://example.com', purchase_pinkoi: null, purchase_shopee: null, hero_image_url: null }
    const existing: LinkCheckRow = { id: 'r1', brand_id: 'b1', field: 'purchase_website', url: 'https://example.com', consecutive_failures: 2, last_ok_at: null, auto_nulled_at: null }
    const { client, spies } = makeSupabaseMock([brand], [existing])
    spies.brandsUpdateEq.mockResolvedValue({ error: { message: 'transient failure' } })
    vi.mocked(createServiceClient).mockReturnValue(client as never)

    const brokenFetch = vi.fn().mockResolvedValue({ status: 500, ok: false } as Response)
    const result = await runLinkHealthCheck({ fetchFn: brokenFetch, deliverFn: silentDeliver })

    // auto_nulled_at must NOT be stamped and the summary must not report a null
    expect(spies.linkUpdateFn).not.toHaveBeenCalled()
    expect(result.autoNulled).toHaveLength(0)
  })

  it('resets counter when brand URL changes', async () => {
    // Brand URL changed from old to new
    const brand: BrandRow = { id: 'b1', purchase_website: 'https://new.example.com', purchase_pinkoi: null, purchase_shopee: null, hero_image_url: null }
    const existing: LinkCheckRow = { id: 'r1', brand_id: 'b1', field: 'purchase_website', url: 'https://old.example.com', consecutive_failures: 2, last_ok_at: null, auto_nulled_at: null }
    const { client, spies } = makeSupabaseMock([brand], [existing])
    vi.mocked(createServiceClient).mockReturnValue(client as never)

    const brokenFetch = vi.fn().mockResolvedValue({ status: 500, ok: false } as Response)

    await runLinkHealthCheck({ fetchFn: brokenFetch, deliverFn: silentDeliver })

    // Should treat as first failure (cf=1), not cf=3
    const upsertArg = spies.linkUpsertFn.mock.calls[0][0] as { consecutive_failures: number; url: string }[]
    const row = upsertArg.find((r) => r.url === 'https://new.example.com')
    expect(row?.consecutive_failures).toBe(1)
    expect(spies.brandsUpdateFn).not.toHaveBeenCalled()
  })

  it('severity is critical when heroBroken is non-empty', async () => {
    const heroUrl = 'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/foo.jpg'
    const brand: BrandRow = { id: 'b1', purchase_website: null, purchase_pinkoi: null, purchase_shopee: null, hero_image_url: heroUrl }
    const { client } = makeSupabaseMock([brand], [])
    vi.mocked(createServiceClient).mockReturnValue(client as never)

    const brokenFetch = vi.fn().mockResolvedValue({ status: 404, ok: false } as Response)
    const result = await runLinkHealthCheck({ fetchFn: brokenFetch, deliverFn: silentDeliver })

    expect(result.severity).toBe('critical')
  })

  it('severity is warning when autoNulled is non-empty', async () => {
    const brand: BrandRow = { id: 'b1', purchase_website: 'https://example.com', purchase_pinkoi: null, purchase_shopee: null, hero_image_url: null }
    const existing: LinkCheckRow = { id: 'r1', brand_id: 'b1', field: 'purchase_website', url: 'https://example.com', consecutive_failures: 2, last_ok_at: null, auto_nulled_at: null }
    const { client } = makeSupabaseMock([brand], [existing])
    vi.mocked(createServiceClient).mockReturnValue(client as never)

    const brokenFetch = vi.fn().mockResolvedValue({ status: 500, ok: false } as Response)
    const result = await runLinkHealthCheck({ fetchFn: brokenFetch, deliverFn: silentDeliver })

    expect(result.severity).toBe('warning')
  })

  it('severity is ok when all checks pass', async () => {
    const brand: BrandRow = { id: 'b1', purchase_website: 'https://example.com', purchase_pinkoi: null, purchase_shopee: null, hero_image_url: null }
    const { client } = makeSupabaseMock([brand], [])
    vi.mocked(createServiceClient).mockReturnValue(client as never)

    const result = await runLinkHealthCheck({ fetchFn: okFetch, deliverFn: silentDeliver })

    expect(result.severity).toBe('ok')
  })

  it('severity is warning when there are broken links (failingRows)', async () => {
    const brand: BrandRow = { id: 'b1', purchase_website: 'https://example.com', purchase_pinkoi: null, purchase_shopee: null, hero_image_url: null }
    const { client } = makeSupabaseMock([brand], [])
    vi.mocked(createServiceClient).mockReturnValue(client as never)

    const brokenFetch = vi.fn().mockResolvedValue({ status: 500, ok: false } as Response)
    const result = await runLinkHealthCheck({ fetchFn: brokenFetch, deliverFn: silentDeliver })

    expect(result.severity).toBe('warning')
    expect(result.failingRows.length).toBeGreaterThan(0)
  })

  it('envelope has correct version/source/routine/project/source_run_id format', async () => {
    const { client } = makeSupabaseMock([], [])
    vi.mocked(createServiceClient).mockReturnValue(client as never)

    let capturedEnvelope: Record<string, unknown> | null = null
    const captureFetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      capturedEnvelope = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ run_id: 'r1', duplicate: false }),
      } as unknown as Response)
    })

    await runLinkHealthCheck({ fetchFn: okFetch, deliverFn: captureFetch })

    expect(capturedEnvelope).not.toBeNull()
    expect(capturedEnvelope!.version).toBe(1)
    expect(capturedEnvelope!.source).toBe('railway_cron')
    expect(capturedEnvelope!.routine).toBe('link-checker')
    expect(capturedEnvelope!.project).toBe('formoria')
    expect(typeof capturedEnvelope!.source_run_id).toBe('string')
    expect((capturedEnvelope!.source_run_id as string).startsWith('railway-cron:')).toBe(true)
    // source_run_id format: railway-cron:YYYY-MM-DD
    expect((capturedEnvelope!.source_run_id as string)).toMatch(/^railway-cron:\d{4}-\d{2}-\d{2}$/)
  })

  it('delivery failure does not throw (fail-soft)', async () => {
    const { client } = makeSupabaseMock([], [])
    vi.mocked(createServiceClient).mockReturnValue(client as never)

    const throwingDeliver = vi.fn().mockRejectedValue(new Error('connection refused'))

    // Should not throw
    await expect(runLinkHealthCheck({ fetchFn: okFetch, deliverFn: throwingDeliver })).resolves.toBeDefined()
  })

  it('social fields (social_instagram etc.) are not checked', async () => {
    // Brand only has social links — no purchase/hero fields
    // Service should load 0 URL tasks and check nothing
    const brand = { id: 'b1', purchase_website: null, purchase_pinkoi: null, purchase_shopee: null, hero_image_url: null }
    const { client } = makeSupabaseMock([brand as BrandRow], [])
    vi.mocked(createServiceClient).mockReturnValue(client as never)

    const mockFetch = vi.fn().mockResolvedValue({ status: 200, ok: true } as Response)

    const result = await runLinkHealthCheck({ fetchFn: mockFetch, deliverFn: silentDeliver })

    expect(result.checked).toBe(0)
    // fetch should only have been called for delivery, not for URL checks
    // (deliverFn is separate, fetchFn is only for URL checks)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
