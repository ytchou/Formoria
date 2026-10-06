import { describe, expect, it } from 'vitest'
import { REPLAY_STEPS } from '../request-replay-steps'
import {
  brandKeyOf,
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

const detect = REPLAY_STEPS.find((s) => s.name === 'detect')!
const faq = REPLAY_STEPS.find((s) => s.name === 'faq')!

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
    expect(span.latest.id).toBe('r3')
    expect(span.answer?.id).toBe('r2')
    expect(span.lastAt).toBe('2026-10-04T00:00:03.000Z')
  })

  it('returns a span with no ok row with a null answer', () => {
    const rows = [
      row({ id: 'r1', auditSpanId: 'span-f', rawResponse: failed }),
      row({ id: 'r2', auditSpanId: 'span-f', createdAt: '2026-10-04T00:00:05.000Z', rawResponse: null }),
    ]

    const { spans } = groupSpans(rows)

    expect(spans).toHaveLength(1)
    expect(spans[0]!.answer).toBeNull()
    expect(spans[0]!.latest.id).toBe('r2')
  })

  it('keeps validation-retry rows with different spans separate', () => {
    const rows = [
      row({ id: 'r1', auditSpanId: 'span-a', request: { v: 1, system: 'sys', user: 'first try' } }),
      row({ id: 'r2', auditSpanId: 'span-b', request: { v: 1, system: 'sys', user: 'retry with feedback' } }),
    ]

    const { spans } = groupSpans(rows)

    expect(spans.map((s) => s.spanId).sort()).toEqual(['span-a', 'span-b'])
    expect(spans.map((s) => s.latest.id).sort()).toEqual(['r1', 'r2'])
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
    expect(spans.map((s) => s.latest.id)).toEqual(['r1'])
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

type ReaderCall = { from: number; to: number; phases: string[]; since?: string }

/** Serves pages of the given sizes in order, then empty pages. */
function sizedReader(sizes: number[], calls: ReaderCall[]): ReplayRowReader {
  let offset = 0
  return async (range, filter) => {
    calls.push({ ...range, phases: filter.phases, ...(filter.since ? { since: filter.since } : {}) })
    const size = sizes[calls.length - 1] ?? 0
    const page = pageOf(offset, size)
    offset += size
    return page
  }
}

describe('loadReplaySpans', () => {
  it('reads pages until an empty page when no limit is given, newest first', async () => {
    const calls: ReaderCall[] = []

    const result = await loadReplaySpans(
      { steps: [detect], since: '2026-10-01' },
      { readRows: sizedReader([200, 200, 37, 0], calls) },
    )

    expect(calls).toHaveLength(4)
    expect(calls[0]).toEqual({ from: 0, to: REPLAY_PAGE_SIZE - 1, phases: ['detect'], since: '2026-10-01' })
    expect(calls[1]).toMatchObject({ from: 200, to: 399 })
    expect(calls[3]).toMatchObject({ from: 437, to: 636 })
    expect(result.rowsRead).toBe(437)
    expect(result.spans.slice(0, 3).map((s) => s.spanId)).toEqual(['span-0', 'span-1', 'span-2'])
  })

  it('stops paging once every requested step has seen more than limit spans', async () => {
    const calls: ReaderCall[] = []

    const result = await loadReplaySpans(
      { steps: [detect], limit: 5 },
      { readRows: sizedReader([200, 200, 37, 0], calls) },
    )

    expect(calls).toHaveLength(1)
    expect(result.rowsRead).toBe(200)
    expect(result.spans.map((s) => s.spanId)).toEqual(['span-0', 'span-1', 'span-2', 'span-3', 'span-4'])
  })

  it('keeps paging to an empty page while a requested step is still short of its limit', async () => {
    const calls: ReaderCall[] = []

    const result = await loadReplaySpans(
      { steps: [detect, faq], limit: 5 },
      { readRows: sizedReader([200, 200, 37, 0], calls) },
    )

    expect(calls).toHaveLength(4)
    expect(result.spans.map((s) => s.spanId)).toEqual(['span-0', 'span-1', 'span-2', 'span-3', 'span-4'])
  })

  it('dedupes a row that a shifted offset page returns twice', async () => {
    const pages = [
      [row({ id: 'r1', auditSpanId: 'span-a', createdAt: '2026-10-04T00:00:03.000Z' }), row({ id: 'u1', phase: 'not_a_catalog_phase' })],
      // A production insert shifted the offset: u1 comes back on the next page.
      [row({ id: 'u1', phase: 'not_a_catalog_phase' }), row({ id: 'r2', auditSpanId: 'span-a', createdAt: '2026-10-04T00:00:01.000Z' })],
      [],
    ]
    let call = 0
    const reader: ReplayRowReader = async () => pages[call++] ?? []

    const result = await loadReplaySpans({ steps: [detect] }, { readRows: reader })

    expect(result.rowsRead).toBe(3)
    expect(result.unclassified).toBe(1)
    expect(result.spans).toHaveLength(1)
    expect(result.spans[0]!.latest.id).toBe('r1')
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

    expect(result.spans.map((s) => s.latest.id)).toEqual(['d2'])
    expect(result.unclassified).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// brandKeyOf
// ---------------------------------------------------------------------------

describe('brandKeyOf', () => {
  function spanOf(overrides: Partial<ReplayRow>, answered = true) {
    const lead = row({ id: 'r-key', ...overrides })
    return { spanId: 'span-key', step: detect, answer: answered ? lead : null, latest: lead, lastAt: lead.createdAt }
  }

  it('uses brand_id, else the submission brand, else the submission, else the span', () => {
    const keys = [
      spanOf({ brandId: 'brand-aa01' }),
      spanOf({ brandId: null, submissionId: 'sub-bb01', submissionBrandId: 'brand-aa01' }),
      spanOf({ brandId: null, submissionId: 'sub-bb02' }),
      spanOf({ brandId: null, submissionId: 'sub-bb02' }, false),
      spanOf({ brandId: 'brand-aa02' }),
      spanOf({ brandId: null }),
    ].map(brandKeyOf)

    expect(keys).toEqual([
      'brand:brand-aa01',
      'brand:brand-aa01',
      'submission:sub-bb02',
      'submission:sub-bb02',
      'brand:brand-aa02',
      'span:span-key',
    ])
    expect(new Set(keys.slice(0, 5)).size).toBe(3)
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
