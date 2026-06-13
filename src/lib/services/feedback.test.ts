import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// --- Supabase mock ---
const mockUpsert = vi.fn()
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockSelect = vi.fn()
const mockOrder = vi.fn()
const mockEq = vi.fn()
const mockSingle = vi.fn()

const mockFrom = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({ from: mockFrom }),
}))

beforeEach(() => {
  vi.clearAllMocks()

  mockOrder.mockResolvedValue({ data: [], error: null })
  mockEq.mockResolvedValue({ data: null, error: null })
  mockSingle.mockResolvedValue({ data: { id: 'new-id' }, error: null })

  mockSelect.mockReturnValue({ order: mockOrder, eq: mockEq, single: mockSingle })
  mockInsert.mockReturnValue({ select: vi.fn().mockReturnValue({ single: mockSingle }) })
  mockUpdate.mockReturnValue({ eq: mockEq })
  mockUpsert.mockResolvedValue({ error: null })

  mockFrom.mockReturnValue({
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    upsert: mockUpsert,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.SENTRY_ORG
  delete process.env.SENTRY_PROJECT
  delete process.env.SENTRY_API_TOKEN
})

// ---- createFeedbackFromTally ----

describe('createFeedbackFromTally', () => {
  it('upserts tally feedback with correct snake_case shape', async () => {
    const { createFeedbackFromTally } = await import('./feedback')

    await createFeedbackFromTally({
      tallyResponseId: 'resp_001',
      type: 'feedback',
      title: 'Product rating',
      body: 'Love it',
      url: 'https://formoria.com/brands/test-brand',
      userEmail: 'user@example.com',
      metadata: { rating: 5 },
    })

    expect(mockFrom).toHaveBeenCalledWith('feedback')
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'tally',
        type: 'feedback',
        title: 'Product rating',
        body: 'Love it',
        tally_response_id: 'resp_001',
        user_email: 'user@example.com',
        metadata: { rating: 5 },
      }),
      { onConflict: 'tally_response_id', ignoreDuplicates: true }
    )
  })
})

// ---- syncSentryFeedback ----

describe('syncSentryFeedback', () => {
  it('throws if Sentry env vars are missing', async () => {
    const { syncSentryFeedback } = await import('./feedback')
    await expect(syncSentryFeedback()).rejects.toThrow(/not configured/)
  })

  it('calls Sentry API and upserts feedback with correct shape', async () => {
    process.env.SENTRY_ORG = 'test-org'
    process.env.SENTRY_PROJECT = 'test-project'
    process.env.SENTRY_API_TOKEN = 'sntrys_test'

    const sentryResponse = [
      {
        id: 'sentry_fb_1',
        eventID: 'event_abc123',
        name: 'Test User',
        email: 'tester@example.com',
        comments: 'The search is broken',
        dateCreated: '2026-06-12T10:00:00.000Z',
      },
    ]

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(sentryResponse),
        headers: { get: () => null },
      })
    )

    const { syncSentryFeedback } = await import('./feedback')
    const result = await syncSentryFeedback()

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/0/projects/test-org/test-project/user-feedback/'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sntrys_test' }),
      })
    )
    expect(mockUpsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          source: 'sentry',
          type: 'bug',
          title: null,
          sentry_feedback_id: 'sentry_fb_1',
          sentry_event_id: 'event_abc123',
          user_email: 'tester@example.com',
        }),
      ],
      { onConflict: 'sentry_feedback_id' }
    )
    expect(result).toEqual({ synced: 1, errors: 0 })
  })

  it('returns error count when upsert fails', async () => {
    process.env.SENTRY_ORG = 'org'
    process.env.SENTRY_PROJECT = 'proj'
    process.env.SENTRY_API_TOKEN = 'token'

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([{ id: 'fb_1', eventID: 'ev_1', name: '', email: '', comments: 'x', dateCreated: new Date().toISOString() }]),
        headers: { get: () => null },
      })
    )
    mockUpsert.mockResolvedValue({ error: { message: 'db error', code: '42000' } })

    const { syncSentryFeedback } = await import('./feedback')
    const result = await syncSentryFeedback()

    expect(result.errors).toBe(1)
    expect(result.synced).toBe(0)
  })
})

// ---- updateFeedbackStatus ----

describe('updateFeedbackStatus', () => {
  it('sets reviewed_at when status is reviewed', async () => {
    const { updateFeedbackStatus } = await import('./feedback')
    await updateFeedbackStatus('feedback-id-1', 'reviewed')

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'reviewed',
        reviewed_at: expect.any(String),
      })
    )
    expect(mockEq).toHaveBeenCalledWith('id', 'feedback-id-1')
  })

  it('does not set reviewed_at when status is closed', async () => {
    const { updateFeedbackStatus } = await import('./feedback')
    await updateFeedbackStatus('feedback-id-2', 'closed')

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'closed' })
    )
    const updateArgs = mockUpdate.mock.calls[0][0]
    expect(updateArgs).not.toHaveProperty('reviewed_at')
  })
})

// ---- getFeedbackItems ----

describe('getFeedbackItems', () => {
  it('returns mapped domain objects', async () => {
    mockOrder.mockResolvedValue({
      data: [
        {
          id: 'fb-1',
          source: 'tally',
          type: 'feedback',
          title: 'Great site',
          body: 'Keep it up',
          url: null,
          status: 'open',
          user_email: null,
          sentry_event_id: null,
          sentry_feedback_id: null,
          tally_response_id: 'resp_1',
          metadata: {},
          reviewed_at: null,
          created_at: '2026-06-12T00:00:00Z',
        },
      ],
      error: null,
    })

    const { getFeedbackItems } = await import('./feedback')
    const items = await getFeedbackItems()

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'fb-1',
      source: 'tally',
      type: 'feedback',
      tallyResponseId: 'resp_1',
    })
  })
})
