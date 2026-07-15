import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getCurationJob, listCurationJobTargets } from '@/lib/services/curation-jobs'
import { exportJobRunLog, MAX_EVENTS_PER_PHASE } from '@/lib/services/runlog-export'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}))

vi.mock('@/lib/services/curation-jobs', () => ({
  getCurationJob: vi.fn(),
  listCurationJobTargets: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({ from: mocks.from }),
}))

function mockQueryRows(rowsByTable: Record<string, { direct: unknown[]; legacy?: unknown[] }>) {
  mocks.from.mockImplementation((table: string) => {
    const filters = new Map<string, unknown>()
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => {
        filters.set(column, value)
        return query
      },
      in: (column: string, value: unknown) => {
        filters.set(column, value)
        return query
      },
      gte: () => query,
      lte: () => query,
      order: () => query,
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => {
        const source = filters.has('job_id') ? rowsByTable[table]?.direct ?? [] : rowsByTable[table]?.legacy ?? []
        return Promise.resolve({ data: source, error: null }).then(resolve)
      },
    }
    return query
  })
}

const job = {
  id: 'job-1',
  operation: 'enrich',
  status: 'completed',
  trigger: 'cron',
  started_by: 'curation-worker',
  started_at: '2026-07-15T02:00:00.000Z',
  completed_at: '2026-07-15T02:00:20.000Z',
  parent_job_id: null,
  attempt: 1,
  succeeded_count: 2,
  skipped_count: 0,
  failed_count: 1,
  target_total: 3,
  job_error: 'Bearer secret-token failed',
}

const targets = [
  {
    target_id: 'brand-1',
    target_type: 'brand',
    brand_slug: 'acme',
    brand_name: 'Acme',
    status: 'succeeded',
    phase_results: [
      { phase: 'discover', status: 'succeeded', durationMs: 800, changedFields: [] },
      { phase: 'detect', status: 'succeeded', durationMs: 1_200, changedFields: [] },
      { phase: 'persist', status: 'succeeded', durationMs: 300, changedFields: [] },
    ],
  },
  {
    target_id: 'submission-1',
    target_type: 'submission',
    brand_slug: 'island-tools',
    brand_name: 'Island Tools',
    status: 'failed',
    phase_results: [
      { phase: 'detect', status: 'failed', durationMs: 900, changedFields: [], error: 'token=private-value' },
    ],
  },
]

describe('exportJobRunLog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getCurationJob).mockResolvedValue(job as never)
    vi.mocked(listCurationJobTargets).mockResolvedValue(targets as never)
  })

  it('exports ordered phases, audit events, token rollups, and sanitized errors', async () => {
    mockQueryRows({
      brand_ai_results: {
        direct: [
          {
            id: 'ai-1',
            brand_id: 'brand-1',
            submission_id: null,
            phase: 'detect',
            model: 'deepseek-v4-flash',
            latency_ms: 650,
            created_at: '2026-07-15T02:00:02.000Z',
            attempt: 1,
            usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
            response_usage: null,
            audit_ok: true,
          },
          {
            id: 'ai-2',
            brand_id: null,
            submission_id: 'submission-1',
            phase: 'detect',
            model: 'deepseek-v4-flash',
            latency_ms: 700,
            created_at: '2026-07-15T02:00:03.000Z',
            attempt: 2,
            usage: null,
            response_usage: { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 },
            audit_ok: false,
            audit_error: 'password=private-value',
          },
          {
            id: 'ai-3',
            brand_id: 'brand-1',
            submission_id: null,
            phase: 'detect',
            model: 'deepseek-v4-flash',
            latency_ms: 300,
            created_at: '2026-07-15T02:00:04.000Z',
            attempt: 1,
            usage: null,
            response_usage: null,
            audit_ok: true,
          },
        ],
      },
      brand_search_results: {
        direct: [
          {
            id: 'search-1',
            brand_id: 'brand-1',
            submission_id: null,
            search_type: 'serp',
            query: 'Acme Taiwan brand',
            urls: ['https://acme.example'],
            latency_ms: 410,
            created_at: '2026-07-15T02:00:01.000Z',
          },
        ],
      },
    })

    const runlog = await exportJobRunLog('job-1')

    expect(runlog.phases.map((phase) => phase.name)).toEqual(['discover', 'detect', 'persist'])
    expect(runlog.phases.find((phase) => phase.name === 'detect')?.durationMs).toBe(2_100)
    expect(runlog.summary).toMatchObject({
      callCount: 3,
      queryCount: 1,
      tokens: { input: 180, output: 60, total: 240 },
      outcomes: { succeeded: 2, skipped: 0, failed: 1 },
    })
    expect(runlog.gaps).toContain('AI audit row ai-3 has no token usage')
    expect(JSON.stringify(runlog)).not.toContain('private-value')
  })

  it('caps phase events while retaining errors first', async () => {
    mockQueryRows({
      brand_ai_results: {
        direct: Array.from({ length: 310 }, (_, index) => ({
          id: `ai-${index}`,
          brand_id: 'brand-1',
          submission_id: null,
          phase: 'detect',
          model: 'deepseek-v4-flash',
          latency_ms: index,
          created_at: new Date(Date.UTC(2026, 6, 15, 2, 0, index)).toISOString(),
          attempt: 1,
          usage: { total_tokens: 1 },
          response_usage: null,
          audit_ok: index !== 2,
        })),
      },
      brand_search_results: { direct: [] },
    })

    const runlog = await exportJobRunLog('job-1')
    const detect = runlog.phases.find((phase) => phase.name === 'detect')

    expect(detect?.events).toHaveLength(MAX_EVENTS_PER_PHASE)
    expect(detect?.eventsTruncated).toBeGreaterThan(0)
    expect(detect?.events.at(0)?.status).toBe('error')
  })

  it('falls back to target and time-window queries for legacy jobs', async () => {
    mockQueryRows({
      brand_ai_results: {
        direct: [],
        legacy: [{
          id: 'legacy-ai',
          brand_id: 'brand-1',
          submission_id: null,
          phase: 'detect',
          model: 'deepseek-v4-flash',
          latency_ms: 500,
          created_at: '2026-07-15T02:00:02.000Z',
          attempt: 1,
          usage: { total_tokens: 50 },
          response_usage: null,
          audit_ok: true,
        }],
      },
      brand_search_results: { direct: [], legacy: [] },
    })

    const runlog = await exportJobRunLog('job-1')

    expect(runlog.summary.callCount).toBe(1)
    expect(runlog.gaps).toEqual(expect.arrayContaining([expect.stringContaining('legacy')]))
  })
})
