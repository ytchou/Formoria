import { describe, expect, it } from 'vitest'
import { replayStepByName } from '../request-replay-steps'
import {
  countBrands,
  groupSpans,
  loadReplaySpans,
  REPLAY_PAGE_SIZE,
  toReplayRow,
  type ReplayRow,
  type ReplayRowReader,
} from '../request-replay-load'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SINGLE_REQUEST = { v: 1, system: 'sys', user: 'usr' }

function row(overrides: Partial<ReplayRow> & { id: string }): ReplayRow {
  return {
    phase: 'detect',
    model: 'gpt-5.4-mini',
    createdAt: '2026-10-04T00:00:00.000Z',
    brandId: 'brand-aa01',
    submissionId: null,
    submissionBrandId: null,
    jobId: null,
    auditSpanId: `span-${overrides.id}`,
    request: SINGLE_REQUEST,
    rawResponse: { ok: true, status: 200, response: { choices: [] } },
    meta: null,
    ...overrides,
  }
}

const failed = { ok: false, status: 500, error: 'boom' }

const detect = replayStepByName('detect')!

// ---------------------------------------------------------------------------
// groupSpans
// ---------------------------------------------------------------------------

describe('groupSpans', () => {
  it('groups rows sharing an audit_span_id into one span answered by the last ok row by created_at', () => {
    const rows = [
      row({ id: 'r3', auditSpanId: 'span-x', createdAt: '2026-10-04T00:00:03.000Z', rawResponse: failed }),
      row({ id: 'r1', auditSpanId: 'span-x', createdAt: '2026-10-04T00:00:01.000Z' }),
      row({ id: 'r2', auditSpanId: 'span-x', createdAt: '2026-10-04T00:00:02.000Z' }),
    ]

    const { spans, unclassified } = groupSpans(rows)

    expect(unclassified).toBe(0)
    expect(spans).toHaveLength(1)
    const span = spans[0]!
    expect(span.spanId).toBe('span-x')
    expect(span.step).toBe(detect)
    expect(span.rows.map((r) => r.id)).toEqual(['r1', 'r2', 'r3'])
    expect(span.answer?.id).toBe('r2')
    expect(span.prodFailed).toBe(false)
    expect(span.lastAt).toBe('2026-10-04T00:00:03.000Z')
  })

  it('returns a span with no ok row as prodFailed', () => {
    const rows = [
      row({ id: 'r1', auditSpanId: 'span-f', rawResponse: failed }),
      row({ id: 'r2', auditSpanId: 'span-f', createdAt: '2026-10-04T00:00:05.000Z', rawResponse: null }),
    ]

    const { spans } = groupSpans(rows)

    expect(spans).toHaveLength(1)
    expect(spans[0]!.prodFailed).toBe(true)
    expect(spans[0]!.answer).toBeNull()
  })

  it('keeps validation-retry rows with different spans separate', () => {
    const rows = [
      row({ id: 'r1', auditSpanId: 'span-a', request: { v: 1, system: 'sys', user: 'first try' } }),
      row({ id: 'r2', auditSpanId: 'span-b', request: { v: 1, system: 'sys', user: 'retry with feedback' } }),
    ]

    const { spans } = groupSpans(rows)

    expect(spans.map((s) => s.spanId).sort()).toEqual(['span-a', 'span-b'])
    expect(spans.every((s) => s.rows.length === 1)).toBe(true)
  })

  it('treats a row with no audit_span_id as its own span', () => {
    const rows = [row({ id: 'r1', auditSpanId: null }), row({ id: 'r2', auditSpanId: null })]

    const { spans } = groupSpans(rows)

    expect(spans).toHaveLength(2)
  })

  it('counts unclassified rows and never returns them as spans', () => {
    const rows = [
      row({ id: 'r1' }),
      row({ id: 'r2', phase: 'not_a_catalog_phase' }),
      row({ id: 'r3', request: { v: 1 } }),
    ]

    const { spans, unclassified } = groupSpans(rows)

    expect(unclassified).toBe(2)
    expect(spans.map((s) => s.rows[0]!.id)).toEqual(['r1'])
  })
})

// ---------------------------------------------------------------------------
// loadReplaySpans
// ---------------------------------------------------------------------------

function pageOf(start: number, size: number): ReplayRow[] {
  return Array.from({ length: size }, (_, i) => {
    const n = start + i
    // Newest first, as the production reader orders them.
    const createdAt = new Date(Date.UTC(2026, 9, 4) - n * 1000).toISOString()
    return row({ id: `row-${n}`, auditSpanId: `span-${n}`, createdAt })
  })
}

describe('loadReplaySpans', () => {
  it('reads pages until an empty page and applies limit as spans, newest first', async () => {
    const sizes = [200, 200, 37, 0]
    const calls: Array<{ from: number; to: number; phases: string[]; since?: string }> = []
    let offset = 0
    const reader: ReplayRowReader = async (range, filter) => {
      calls.push({ ...range, phases: filter.phases, ...(filter.since ? { since: filter.since } : {}) })
      const size = sizes[calls.length - 1] ?? 0
      const page = pageOf(offset, size)
      offset += size
      return page
    }

    const result = await loadReplaySpans(
      { steps: [detect], since: '2026-10-01', limit: 5 },
      { readRows: reader },
    )

    expect(calls).toHaveLength(4)
    expect(calls[0]).toEqual({ from: 0, to: REPLAY_PAGE_SIZE - 1, phases: ['detect'], since: '2026-10-01' })
    expect(calls[1]).toMatchObject({ from: 200, to: 399 })
    expect(calls[3]).toMatchObject({ from: 437, to: 636 })
    expect(result.rowsRead).toBe(437)
    expect(result.spans.map((s) => s.spanId)).toEqual(['span-0', 'span-1', 'span-2', 'span-3', 'span-4'])
  })

  it('applies limit per step and ignores rows of steps not requested', async () => {
    const rows = [
      row({ id: 'd1', createdAt: '2026-10-04T00:00:01.000Z' }),
      row({ id: 'd2', createdAt: '2026-10-04T00:00:02.000Z' }),
      row({ id: 'u1', phase: 'not_a_catalog_phase' }),
    ]
    let served = false
    const reader: ReplayRowReader = async () => {
      if (served) return []
      served = true
      return rows
    }

    const result = await loadReplaySpans({ steps: [detect], limit: 1 }, { readRows: reader })

    expect(result.spans.map((s) => s.rows[0]!.id)).toEqual(['d2'])
    expect(result.unclassified).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// countBrands
// ---------------------------------------------------------------------------

describe('countBrands', () => {
  it('uses brand_id, else the submission brand, else counts the submission as one', () => {
    const count = countBrands([
      { brandId: 'brand-aa01', submissionId: null, submissionBrandId: null },
      { brandId: null, submissionId: 'sub-bb01', submissionBrandId: 'brand-aa01' },
      { brandId: null, submissionId: 'sub-bb02', submissionBrandId: null },
      { brandId: null, submissionId: 'sub-bb02', submissionBrandId: null },
      { brandId: 'brand-aa02', submissionId: null, submissionBrandId: null },
    ])

    expect(count).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// toReplayRow
// ---------------------------------------------------------------------------

describe('toReplayRow', () => {
  it('maps the db row to camelCase, keeping only meta from input', () => {
    const mapped = toReplayRow({
      id: 'row-db1',
      phase: 'detect',
      model: 'gpt-5.4-mini',
      created_at: '2026-10-04T00:00:00.000Z',
      brand_id: null,
      submission_id: 'sub-cc01',
      job_id: 'job-cc01',
      audit_span_id: 'span-cc01',
      request: SINGLE_REQUEST,
      raw_response: { ok: true },
      input: { system: 'big', user: 'big', meta: { imageIds: ['img-1'] } },
      brand_submissions: [{ brand_id: 'brand-cc01' }],
    })

    expect(mapped).toEqual({
      id: 'row-db1',
      phase: 'detect',
      model: 'gpt-5.4-mini',
      createdAt: '2026-10-04T00:00:00.000Z',
      brandId: null,
      submissionId: 'sub-cc01',
      submissionBrandId: 'brand-cc01',
      jobId: 'job-cc01',
      auditSpanId: 'span-cc01',
      request: SINGLE_REQUEST,
      rawResponse: { ok: true },
      meta: { imageIds: ['img-1'] },
    })
  })
})
