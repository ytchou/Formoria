import { describe, expect, it } from 'vitest'

import { scoreReplayResponse, type NormalizedResponse, type ScoreHints } from '../request-replay-score'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NO_HINTS: ScoreHints = { keyFields: [], proseFields: [] }
const json = (value: unknown): NormalizedResponse => ({ kind: 'json', value })
const tools = (...calls: Array<{ name: string; args: unknown }>): NormalizedResponse => ({ kind: 'tools', calls })

// ---------------------------------------------------------------------------
// Leaves
// ---------------------------------------------------------------------------

describe('scoreReplayResponse — leaves', () => {
  it('scores equal enum, string and boolean leaves 1', () => {
    const value = { confidence: 'high', name: 'Acme', isNonBrand: false, city: null }
    const score = scoreReplayResponse(json(value), json({ ...value }), NO_HINTS)
    expect(score.agreement).toBe(1)
    expect(score.parseFailed).toBe(false)
  })

  it('scores unequal leaves 0 and averages over leaves', () => {
    const expected = { confidence: 'high', isNonBrand: false }
    const candidate = { confidence: 'low', isNonBrand: false }
    expect(scoreReplayResponse(json(candidate), json(expected), NO_HINTS).agreement).toBe(0.5)
  })

  it('scores a missing key as a 0 leaf', () => {
    expect(scoreReplayResponse(json({ a: 'x' }), json({ a: 'x', b: true }), NO_HINTS).agreement).toBe(0.5)
  })

  it('scores primitive arrays by set Jaccard', () => {
    const score = scoreReplayResponse(json({ tags: ['b', 'c'] }), json({ tags: ['a', 'b'] }), NO_HINTS)
    expect(score.agreement).toBeCloseTo(1 / 3)
  })

  it('recurses into object arrays, pairing each element with its best match', () => {
    const expected = { items: [{ d: 'keep' }, { d: 'reject' }] }
    const candidate = { items: [{ d: 'keep' }, { d: 'keep' }] }
    expect(scoreReplayResponse(json(candidate), json(expected), NO_HINTS).agreement).toBe(0.5)
  })

  it('scores a reordered-but-equal object array as full agreement', () => {
    const hints: ScoreHints = { keyFields: ['entries[].preset_id'], proseFields: ['entries[].answer_zh'] }
    const a = { preset_id: 'faq-origin', answer_zh: '台灣製造' }
    const b = { preset_id: 'faq-shipping', answer_zh: '三天內出貨' }
    const score = scoreReplayResponse(json({ entries: [b, a] }), json({ entries: [a, b] }), hints)
    expect(score.agreement).toBe(1)
    expect(score.keyAgreement).toBe(1)
    expect(score.prose.every((p) => !p.changed)).toBe(true)
  })

  it('excludes numbers from agreement and reports their absolute delta', () => {
    const score = scoreReplayResponse(
      json({ verdict: 'keep', score: 0.25, year: 2010 }),
      json({ verdict: 'keep', score: 0.75, year: 2010 }),
      NO_HINTS,
    )
    expect(score.agreement).toBe(1)
    expect(score.numberDeltas).toEqual([
      { path: 'score', absDelta: 0.5 },
      { path: 'year', absDelta: 0 },
    ])
  })

  it('counts a number against null as a disagreeing leaf', () => {
    const score = scoreReplayResponse(json({ year: null }), json({ year: 2010 }), NO_HINTS)
    expect(score.agreement).toBe(0)
    expect(score.numberDeltas).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Prose and key fields
// ---------------------------------------------------------------------------

describe('scoreReplayResponse — prose and key fields', () => {
  it('reports prose as changed plus lengths and keeps it out of agreement', () => {
    const hints: ScoreHints = { keyFields: [], proseFields: ['reasoning', 'entries[].answer'] }
    const score = scoreReplayResponse(
      json({ verdict: 'keep', reasoning: 'short', entries: [{ id: 'a', answer: '同樣' }] }),
      json({ verdict: 'keep', reasoning: 'a longer one', entries: [{ id: 'a', answer: '同樣' }] }),
      hints,
    )
    expect(score.agreement).toBe(1)
    expect(score.prose).toEqual([
      { path: 'reasoning', changed: true, expectedLength: 12, candidateLength: 5 },
      { path: 'entries[].answer', changed: false, expectedLength: 2, candidateLength: 2 },
    ])
  })

  it('returns null agreement when every leaf is prose', () => {
    const hints: ScoreHints = { keyFields: [], proseFields: ['description', 'blurb'] }
    const score = scoreReplayResponse(json({ description: 'a', blurb: null }), json({ description: 'b', blurb: null }), hints)
    expect(score.agreement).toBeNull()
    expect(score.keyAgreement).toBeNull()
    expect(score.prose.map((p) => p.changed)).toEqual([true, false])
  })

  it('computes key-field agreement over the hint key fields only', () => {
    const hints: ScoreHints = { keyFields: ['verdict', 'items[].disposition'], proseFields: [] }
    const expected = { verdict: 'thin', other: 'x', items: [{ disposition: 'keep', id: '1' }, { disposition: 'reject', id: '2' }] }
    const candidate = { verdict: 'thin', other: 'y', items: [{ disposition: 'keep', id: '9' }, { disposition: 'keep', id: '2' }] }
    const score = scoreReplayResponse(json(candidate), json(expected), hints)
    // key leaves: verdict 1, items[0].disposition 1, items[1].disposition 0
    expect(score.keyAgreement).toBeCloseTo(2 / 3)
    // all leaves: verdict 1, other 0, d 1, id 0, d 0, id 1
    expect(score.agreement).toBe(0.5)
  })

  it('counts a missing or extra element against the key fields under its array', () => {
    const hints: ScoreHints = { keyFields: ['entries[].preset_id'], proseFields: [] }
    const expected = { entries: [{ preset_id: 'faq-origin' }, { preset_id: 'faq-shipping' }] }
    const missingOne = scoreReplayResponse(json({ entries: [{ preset_id: 'faq-origin' }] }), json(expected), hints)
    expect(missingOne.keyAgreement).toBe(0.5)

    const extraOne = scoreReplayResponse(
      json({ entries: [...expected.entries, { preset_id: 'faq-care' }] }),
      json(expected),
      hints,
    )
    expect(extraOne.keyAgreement).toBeCloseTo(2 / 3)
  })

  it('counts a missing array against the key fields under it', () => {
    const hints: ScoreHints = { keyFields: ['entries[].preset_id'], proseFields: [] }
    const expected = { entries: [{ preset_id: 'faq-origin' }, { preset_id: 'faq-shipping' }] }
    const score = scoreReplayResponse(json({}), json(expected), hints)
    expect(score.keyAgreement).toBe(0)
    expect(score.agreement).toBe(0)
  })

  it('scores a key array field by Jaccard', () => {
    const hints: ScoreHints = { keyFields: ['reasons'], proseFields: [] }
    const score = scoreReplayResponse(json({ reasons: ['b', 'c'] }), json({ reasons: ['a', 'b'] }), hints)
    expect(score.keyAgreement).toBeCloseTo(1 / 3)
  })
})

// ---------------------------------------------------------------------------
// Tool calls
// ---------------------------------------------------------------------------

describe('scoreReplayResponse — tool calls', () => {
  it('scores a tool name mismatch 0', () => {
    const hints: ScoreHints = { keyFields: ['surfaces[].fetch'], proseFields: [] }
    const score = scoreReplayResponse(
      tools({ name: 'probe_static', args: { url: 'https://example.com' } }),
      tools({ name: 'submit_plan', args: { surfaces: [{ fetch: 'static' }] } }),
      hints,
    )
    expect(score.agreement).toBe(0)
    expect(score.keyAgreement).toBe(0)
  })

  it('scores the args of a same-name call structurally', () => {
    const hints: ScoreHints = { keyFields: ['surfaces[].fetch'], proseFields: ['surfaces[].reason'] }
    const score = scoreReplayResponse(
      tools({ name: 'submit_plan', args: { surfaces: [{ fetch: 'static', url: 'https://b.example', reason: 'x' }] } }),
      tools({ name: 'submit_plan', args: { surfaces: [{ fetch: 'static', url: 'https://a.example', reason: 'y' }] } }),
      hints,
    )
    expect(score.agreement).toBe(0.5)
    expect(score.keyAgreement).toBe(1)
    expect(score.prose).toEqual([{ path: 'surfaces[].reason', changed: true, expectedLength: 1, candidateLength: 1 }])
  })

  it('scores a missing call 0', () => {
    const call = { name: 'probe_static', args: { url: 'https://example.com' } }
    expect(scoreReplayResponse(tools(call), tools(call, call), NO_HINTS).agreement).toBe(0.5)
  })

  it('scores a text answer to a tool turn 0 without a parse failure', () => {
    const score = scoreReplayResponse(
      { kind: 'text', value: 'I would submit a plan' },
      tools({ name: 'submit_plan', args: {} }),
      NO_HINTS,
    )
    expect(score.agreement).toBe(0)
    expect(score.parseFailed).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Parse failure
// ---------------------------------------------------------------------------

describe('scoreReplayResponse — parse failure', () => {
  it('scores unparseable candidate content 0 with parseFailed', () => {
    const hints: ScoreHints = { keyFields: ['verdict'], proseFields: [] }
    const score = scoreReplayResponse({ kind: 'text', value: '{"verdict": "thin"' }, json({ verdict: 'thin' }), hints)
    expect(score).toMatchObject({ agreement: 0, keyAgreement: 0, parseFailed: true })
  })
})
