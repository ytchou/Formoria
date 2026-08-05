import { describe, expect, it } from 'vitest'
import type { CurationJob, CurationJobTarget } from '../curation-jobs'
import { aiEvent, exportJobRunLog, searchEvent } from '../runlog-export'

const targetById = new Map<string, CurationJobTarget>()

describe('run-log audit events', () => {
  it('shows the retry count in an LLM event', () => {
    const event = aiEvent(
      {
        id: 'ai-retry-2',
        brand_id: null,
        submission_id: null,
        phase: 'facts',
        model: 'gpt-5',
        latency_ms: 125,
        created_at: '2026-08-03T00:00:00.000Z',
        attempt: 1,
        retry_attempt: 2,
        usage: { input: 12, output: 8 },
        response_usage: null,
        audit_ok: true,
      },
      targetById,
      [],
    )

    expect(event.summary).toContain('retry 2')
  })

  it('leaves a first-try LLM summary unchanged', () => {
    const event = aiEvent(
      {
        id: 'ai-first-try',
        brand_id: null,
        submission_id: null,
        phase: 'facts',
        model: 'gpt-5',
        latency_ms: 125,
        created_at: '2026-08-03T00:00:00.000Z',
        attempt: 1,
        retry_attempt: 0,
        usage: { input: 12, output: 8 },
        response_usage: null,
        audit_ok: true,
      },
      targetById,
      [],
    )

    expect(event.summary).toBe('gpt-5 facts call')
  })

  it('keeps semantic attempts separate from retry attempts', () => {
    const event = aiEvent(
      {
        id: 'ai-semantic-and-retry',
        brand_id: null,
        submission_id: null,
        phase: 'facts',
        model: 'gpt-5',
        latency_ms: 125,
        created_at: '2026-08-03T00:00:00.000Z',
        attempt: 2,
        retry_attempt: 1,
        usage: { input: 12, output: 8 },
        response_usage: null,
        audit_ok: true,
      },
      targetById,
      [],
    )

    expect(event.summary).toContain('attempt 2')
    expect(event.summary).toContain('retry 1')
  })

  it('labels a retried search event alongside its HTTP status', () => {
    const event = searchEvent(
      {
        id: 'search-retry-2',
        brand_id: null,
        submission_id: null,
        search_type: 'official-site',
        query: 'María García official site',
        urls: [],
        latency_ms: 250,
        created_at: '2026-08-03T00:00:00.000Z',
        call_status: 'network_error',
        http_status: 503,
        retry_attempt: 2,
      },
      targetById,
    )

    expect(event.labels).toMatchObject({ httpStatus: '503', retry: '2' })
  })

  it('omits the retry label on a first-try search event', () => {
    const event = searchEvent(
      {
        id: 'search-first-try',
        brand_id: null,
        submission_id: null,
        search_type: 'official-site',
        query: 'María García official site',
        urls: [],
        latency_ms: 250,
        created_at: '2026-08-03T00:00:00.000Z',
        call_status: 'succeeded',
        http_status: 200,
        retry_attempt: 0,
      },
      targetById,
    )

    expect(event.labels?.retry).toBeUndefined()
  })
})

type AuditResult = { data: unknown[] | null; error: unknown }

type FakeAuditQuery = PromiseLike<AuditResult> & {
  select: (columns: string) => FakeAuditQuery
  eq: (column: string, value: unknown) => FakeAuditQuery
  in: (column: string, values: string[]) => FakeAuditQuery
  gte: (column: string, value: string) => FakeAuditQuery
  lte: (column: string, value: string) => FakeAuditQuery
  neq: (column: string, value: unknown) => FakeAuditQuery
  limit: (count: number) => FakeAuditQuery
  order: (column: string, options: { ascending: boolean }) => FakeAuditQuery
}

function fakeAuditClient(
  correlationResult: AuditResult,
  options: { limits?: number[] } = {},
) {
  return {
    from: (table: string): FakeAuditQuery => {
      const result =
        table === 'external_call_audit'
          ? correlationResult
          : { data: [], error: null }
      const query: FakeAuditQuery = {
        select: () => query,
        eq: () => query,
        in: () => query,
        gte: () => query,
        lte: () => query,
        neq: () => query,
        limit: (count) => {
          options.limits?.push(count)
          return query
        },
        order: () => query,
        then<TResult1 = AuditResult, TResult2 = never>(
          onfulfilled?:
            | ((value: AuditResult) => TResult1 | PromiseLike<TResult1>)
            | null,
          onrejected?:
            | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
            | null,
        ): PromiseLike<TResult1 | TResult2> {
          return Promise.resolve(result).then(onfulfilled, onrejected)
        },
      }
      return query
    },
  }
}

const runlogJob: CurationJob = {
  attempt: 1,
  cancelled_count: 0,
  completed_at: '2026-08-05T03:00:00.000Z',
  created_at: '2026-08-05T02:00:00.000Z',
  current_phase: null,
  current_target_id: null,
  dedupe_key: null,
  dispatch_error: null,
  dispatch_status: 'dispatched',
  dispatched_at: '2026-08-05T02:00:00.000Z',
  dry_run: false,
  failed_count: 0,
  heartbeat_at: null,
  id: 'job-1',
  job_error: null,
  operation: 'enrich',
  params: null,
  parent_job_id: null,
  progress: null,
  result: null,
  run_after: '2026-08-05T02:00:00.000Z',
  scheduled_for: null,
  skipped_count: 0,
  started_at: '2026-08-05T02:00:00.000Z',
  started_by: 'm.garcia+test@company.co.uk',
  status: 'completed',
  succeeded_count: 0,
  target_total: 0,
  trigger: 'admin',
  worker_token: null,
}

describe('run-log correlation', () => {
  it('runlog carries the correlation id for its job', async () => {
    const correlationId = '11111111-1111-4111-8111-111111111111'
    const runlog = await exportJobRunLog('job-1', {
      client: fakeAuditClient({
        data: [{ correlation_id: correlationId }],
        error: null,
      }),
      getJob: async () => runlogJob,
      listTargets: async () => [],
    })

    expect(runlog.run.correlationId).toBe(correlationId)
  })

  it('bounds correlation reads and notes ambiguous job correlations', async () => {
    const limits: number[] = []
    const firstCorrelationId = '11111111-1111-4111-8111-111111111111'
    const runlog = await exportJobRunLog('job-1', {
      client: fakeAuditClient(
        {
          data: [
            { correlation_id: firstCorrelationId },
            { correlation_id: '22222222-2222-4222-8222-222222222222' },
          ],
          error: null,
        },
        { limits },
      ),
      getJob: async () => runlogJob,
      listTargets: async () => [],
    })

    expect(runlog.run.correlationId).toBe(firstCorrelationId)
    expect(runlog.gaps).toContain(
      'Job has multiple correlation_id values; this export cannot identify one correlation',
    )
    expect(limits).toEqual([1, 1])
  })

  it('export degrades gracefully when correlation_id is absent', async () => {
    const runlog = await exportJobRunLog('job-1', {
      client: fakeAuditClient({
        data: null,
        error: {
          code: '42703',
          message: 'column external_call_audit.correlation_id does not exist',
        },
      }),
      getJob: async () => runlogJob,
      listTargets: async () => [],
    })

    expect(runlog.run.correlationId).toBeUndefined()
    expect(runlog.gaps).toContain(
      'Job correlation_id is unavailable; audit rows cannot be correlated until the correlation_id migration is applied',
    )
  })

  it('uses a generic gap for a transient correlation read error', async () => {
    const runlog = await exportJobRunLog('job-1', {
      client: fakeAuditClient({
        data: null,
        error: { code: '500', message: 'audit service temporarily unavailable' },
      }),
      getJob: async () => runlogJob,
      listTargets: async () => [],
    })

    expect(runlog.run.correlationId).toBeUndefined()
    expect(runlog.gaps).toContain(
      'Job correlation_id could not be read; audit rows may be uncorrelated in this export',
    )
    expect(runlog.gaps).not.toContain(
      'Job correlation_id is unavailable; audit rows cannot be correlated until the correlation_id migration is applied',
    )
  })
})
