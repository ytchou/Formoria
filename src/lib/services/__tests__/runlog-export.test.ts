import { describe, expect, it } from 'vitest'
import type { CurationJobTarget } from '../curation-jobs'
import { aiEvent, searchEvent } from '../runlog-export'

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
