import { describe, expect, it } from 'vitest'

import {
  buildPanelPacket,
  buildStepTable,
  UNDER_POWERED_MIN_SPANS,
  type PanelKey,
  type PanelBlindItem,
  type ReplayArmResult,
  type ReplaySpanResult,
} from '../request-replay-report'
import type { NormalizedResponse, ReplayScore } from '../request-replay-score'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHALLENGER = 'gpt-6-luna'
const INCUMBENT = 'gpt-5-mini'
const UNPRICED = 'model-without-any-price'

const json = (value: unknown): NormalizedResponse => ({ kind: 'json', value })

function score(overrides: Partial<ReplayScore> = {}): ReplayScore {
  return { agreement: 1, keyAgreement: 1, prose: [], numberDeltas: [], parseFailed: false, ...overrides }
}

function arm(overrides: Partial<ReplayArmResult> = {}): ReplayArmResult {
  return {
    model: CHALLENGER,
    output: json({ category: 'tea' }),
    score: score(),
    latencyMs: 100,
    costUsd: 0.001,
    tokens: { promptTokens: 1000, completionTokens: 100 },
    failure: null,
    offSlot: false,
    paramFallback: false,
    ...overrides,
  }
}

function span(i: number, overrides: Partial<ReplaySpanResult> = {}): ReplaySpanResult {
  return {
    spanId: `span-replay-${i}`,
    step: 'detect',
    brandKey: `brand-tea-${i}`,
    storedModel: INCUMBENT,
    expected: json({ category: 'tea' }),
    evidence: { user: `evidence for span ${i}` },
    skip: null,
    challenger: arm(),
    incumbent: arm({ model: INCUMBENT, costUsd: 0.002 }),
    ...overrides,
  }
}

function spans(n: number, make: (i: number) => Partial<ReplaySpanResult> = () => ({})): ReplaySpanResult[] {
  return Array.from({ length: n }, (_, i) => span(i, make(i)))
}

/** The single data row of a step table, split into trimmed cells. */
function dataCells(markdown: string): string[] {
  const rows = markdown.split('\n').filter((l) => l.startsWith('|'))
  expect(rows).toHaveLength(3) // header, separator, one data row
  return rows[2]!
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim())
}

function headerCells(markdown: string): string[] {
  const header = markdown.split('\n').find((l) => l.startsWith('|'))!
  return header
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim())
}

function cell(markdown: string, column: string): string {
  const idx = headerCells(markdown).indexOf(column)
  expect(idx).toBeGreaterThanOrEqual(0)
  return dataCells(markdown)[idx]!
}

// ---------------------------------------------------------------------------
// buildStepTable
// ---------------------------------------------------------------------------

describe('buildStepTable — columns', () => {
  it('has every D12 column', () => {
    const { markdown } = buildStepTable('detect', spans(3))
    expect(headerCells(markdown)).toEqual([
      'spans',
      'distinct brands',
      'challenger agreement',
      'noise-floor agreement',
      'key-field agreement',
      'noise-floor key-field agreement',
      'prose changed',
      'prose length ratio',
      'number deltas',
      'p50 latency',
      'p95 latency',
      '$/call',
      'failures',
      'off-slot',
      'paramFallback',
      'skips',
    ])
  })

  it('takes p50 and p95 from the challenger latencies', () => {
    const latencies = [100, 200, 300, 400, 1000]
    const { stats, markdown } = buildStepTable(
      'detect',
      spans(5, (i) => ({ challenger: arm({ latencyMs: latencies[i]! }) })),
    )
    expect(stats.latencyP50Ms).toBe(300)
    expect(stats.latencyP95Ms).toBe(1000)
    expect(cell(markdown, 'p50 latency')).toBe('300 ms')
    expect(cell(markdown, 'p95 latency')).toBe('1000 ms')
  })

  it('reports agreement, key agreement, prose-changed share, distinct brands and counts', () => {
    const rows = spans(4, (i) => ({
      brandKey: i < 2 ? 'brand-tea-shared' : `brand-tea-${i}`,
      challenger: arm({
        score: score({
          agreement: i % 2 === 0 ? 1 : 0.5,
          keyAgreement: i === 0 ? 0 : 1,
          prose: [{ path: 'description', changed: i === 1, expectedLength: 10, candidateLength: 12 }],
        }),
        paramFallback: i >= 2,
      }),
      incumbent: arm({ model: INCUMBENT, score: score({ agreement: 0.9, keyAgreement: 0.5 }), offSlot: i === 3 }),
    }))
    rows.push(span(9, { skip: 'image', challenger: null, incumbent: null }))
    rows.push(span(10, { skip: 'prod-failed', challenger: null, incumbent: null }))
    rows.push(span(11, { challenger: arm({ failure: 'timeout', output: null, score: null }) }))

    const { stats, markdown } = buildStepTable('detect', rows)
    expect(stats.spans).toBe(7)
    expect(stats.distinctBrands).toBe(6)
    expect(stats.challengerAgreement).toBeCloseTo(0.75)
    // Noise floor: three on-slot 0.9 / 0.5 incumbents plus span 11's default 1 / 1; i=3 is off-slot.
    expect(stats.noiseFloorAgreement).toBeCloseTo(0.925)
    expect(stats.keyAgreement).toBeCloseTo(0.75)
    expect(stats.noiseFloorKeyAgreement).toBeCloseTo(0.625)
    expect(stats.proseChangedPct).toBeCloseTo(0.25)
    expect(stats.scoredSpans).toBe(5)
    expect(stats.failures).toBe(1)
    expect(stats.offSlot).toBe(1)
    expect(stats.paramFallback).toBe(2)
    expect(stats.skips).toEqual({ image: 1, 'prod-failed': 1 })

    expect(cell(markdown, 'spans')).toBe('n=7')
    expect(cell(markdown, 'challenger agreement')).toBe('75.0%')
    expect(cell(markdown, 'noise-floor key-field agreement')).toBe('62.5%')
    expect(cell(markdown, 'prose changed')).toBe('25.0%')
    expect(cell(markdown, 'skips')).toBe('image 1, prod-failed 1')
  })

  it('reports number deltas and the prose length ratio', () => {
    const rows = spans(2, (i) => ({
      challenger: arm({
        score: score({
          numberDeltas: [
            { path: 'year', absDelta: 0 },
            { path: 'score', absDelta: i === 0 ? 0.5 : 0.25 },
          ],
          prose: [
            { path: 'description', changed: true, expectedLength: 10, candidateLength: i === 0 ? 12 : 8 },
            { path: 'blurb', changed: false, expectedLength: 0, candidateLength: 0 },
          ],
        }),
      }),
    }))
    const { stats, markdown } = buildStepTable('detect', rows)
    expect(stats.numbers).toEqual({ leaves: 4, changed: 2, meanAbsDelta: 0.1875, maxAbsDelta: 0.5 })
    // 12/10 and 8/10; the empty expected blurb has no ratio.
    expect(stats.proseLengthRatio).toBeCloseTo(1)
    expect(cell(markdown, 'number deltas')).toBe('2/4 changed, mean Δ 0.1875, max Δ 0.5')
    expect(cell(markdown, 'prose length ratio')).toBe('1.00x')
  })

  it('leaves off-slot calls out of challenger and noise-floor agreement, latency and cost', () => {
    const rows = spans(2, (i) => ({
      challenger: arm(
        i === 0
          ? { score: score({ agreement: 0, keyAgreement: 0 }), offSlot: true, latencyMs: 9000, costUsd: 0.5 }
          : { latencyMs: 100, costUsd: 0.001 },
      ),
      incumbent: arm({ model: INCUMBENT, score: score({ agreement: i === 0 ? 0 : 1 }), offSlot: i === 0 }),
    }))
    const { stats } = buildStepTable('detect', rows)
    expect(stats.challengerAgreement).toBe(1)
    expect(stats.keyAgreement).toBe(1)
    expect(stats.noiseFloorAgreement).toBe(1)
    expect(stats.latencyP95Ms).toBe(100)
    expect(stats.costPerCall).toEqual({ usd: 0.001, source: 'db' })
    expect(stats.offSlot).toBe(2)
  })
})

describe('buildStepTable — under-powered flag', () => {
  it('flags a step with fewer than 30 spans', () => {
    const { stats, markdown } = buildStepTable('detect', spans(UNDER_POWERED_MIN_SPANS - 1))
    expect(stats.underPowered).toBe(true)
    expect(markdown).toContain('UNDER-POWERED')
  })

  it('does not flag a step with exactly 30 spans', () => {
    const { stats, markdown } = buildStepTable('detect', spans(UNDER_POWERED_MIN_SPANS))
    expect(stats.underPowered).toBe(false)
    expect(markdown).not.toContain('UNDER-POWERED')
  })

  it('counts only scored spans: 30 spans with a skip are under-powered', () => {
    const rows = spans(UNDER_POWERED_MIN_SPANS, (i) =>
      i === 0 ? { skip: 'image', challenger: null, incumbent: null } : {},
    )
    const { stats, markdown } = buildStepTable('detect', rows)
    expect(stats.underPowered).toBe(true)
    expect(markdown).toContain(`UNDER-POWERED (n=${UNDER_POWERED_MIN_SPANS - 1} < ${UNDER_POWERED_MIN_SPANS})`)
  })
})

describe('buildStepTable — empty step', () => {
  it('prints n=0 in a single row with no agreement', () => {
    const { stats, markdown } = buildStepTable('detect', [])
    expect(stats.spans).toBe(0)
    expect(stats.underPowered).toBe(false)
    expect(markdown.split('\n')[0]).toBe('### detect — n=0')
    expect(stats.challengerAgreement).toBeNull()
    expect(stats.noiseFloorAgreement).toBeNull()
    expect(stats.keyAgreement).toBeNull()
    expect(cell(markdown, 'spans')).toBe('n=0')
    expect(cell(markdown, 'challenger agreement')).toBe('—')
    expect(cell(markdown, 'noise-floor agreement')).toBe('—')
    expect(cell(markdown, 'key-field agreement')).toBe('—')
    expect(cell(markdown, 'number deltas')).toBe('—')
  })
})

describe('buildStepTable — $/call', () => {
  it('uses the DB cost when every call has one', () => {
    const { stats, markdown } = buildStepTable(
      'detect',
      spans(2, (i) => ({ challenger: arm({ costUsd: i === 0 ? 0.001 : 0.003 }) })),
    )
    expect(stats.costPerCall?.source).toBe('db')
    expect(stats.costPerCall?.usd).toBeCloseTo(0.002)
    expect(cell(markdown, '$/call')).toBe('$0.002000')
  })

  it('falls back to the list price, marked (list)', () => {
    const { stats, markdown } = buildStepTable(
      'detect',
      spans(2, () => ({
        challenger: arm({ costUsd: null, tokens: { promptTokens: 1_000_000, completionTokens: 0 } }),
      })),
    )
    // gpt-6-luna list input price is $0.10 per 1M tokens.
    expect(stats.costPerCall?.source).toBe('list')
    expect(stats.costPerCall?.usd).toBeCloseTo(0.1)
    expect(cell(markdown, '$/call')).toBe('$0.100000 (list)')
  })

  it('prints n/a when neither a DB cost nor a list price exists', () => {
    const { stats, markdown } = buildStepTable(
      'detect',
      spans(2, () => ({ challenger: arm({ model: UNPRICED, costUsd: null }) })),
    )
    expect(stats.costPerCall).toBeNull()
    expect(cell(markdown, '$/call')).toBe('n/a')
  })
})

// ---------------------------------------------------------------------------
// buildPanelPacket
// ---------------------------------------------------------------------------

type Written = Record<string, string>

function recorder(): { written: Written; writeFile: (path: string, content: string) => Promise<void> } {
  const written: Written = {}
  return {
    written,
    writeFile: async (path, content) => {
      written[path] = content
    },
  }
}

/** A span the panel should select: its key field disagrees. */
function disagreeing(i: number): ReplaySpanResult {
  return span(i, {
    challenger: arm({ output: json({ category: 'coffee' }), score: score({ keyAgreement: 0 }) }),
  })
}

async function packet(rows: ReplaySpanResult[], opts: { panelMax?: number; seed?: string } = {}) {
  const { written, writeFile } = recorder()
  const result = await buildPanelPacket({
    spans: rows,
    panelMax: opts.panelMax ?? 30,
    seed: opts.seed ?? 'seed-one',
    outDir: '/out/panel',
    writeFile,
  })
  const items = JSON.parse(written['/out/panel/items-blind.json']!) as PanelBlindItem[]
  const key = JSON.parse(written['/out/panel/key.json']!) as PanelKey
  return { result, items, key, written }
}

describe('buildPanelPacket — selection', () => {
  it('selects only spans with a key-field disagreement or changed prose', async () => {
    const agreeing = span(1)
    const keyDisagrees = disagreeing(2)
    const proseChanged = span(3, {
      challenger: arm({
        score: score({ prose: [{ path: 'description', changed: true, expectedLength: 5, candidateLength: 9 }] }),
      }),
    })
    const proseUnchanged = span(4, {
      challenger: arm({
        score: score({ prose: [{ path: 'description', changed: false, expectedLength: 5, candidateLength: 5 }] }),
      }),
    })
    const skipped = span(5, { skip: 'image', challenger: null, incumbent: null })

    const { key } = await packet([agreeing, keyDisagrees, proseChanged, proseUnchanged, skipped])
    expect(Object.values(key).map((k) => k.itemId).sort()).toEqual(['span-replay-2', 'span-replay-3'])
  })

  it('caps at panelMax in md5(spanId) order', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => disagreeing(i))
    const { key: capped } = await packet(rows, { panelMax: 3 })
    const { key: all } = await packet([...rows].reverse(), { panelMax: 10 })

    const cappedIds = Object.values(capped).map((k) => k.itemId)
    const allIds = Object.values(all).map((k) => k.itemId)
    expect(cappedIds).toHaveLength(3)
    // Input order does not matter: the first three in md5 order are kept.
    expect(cappedIds).toEqual(allIds.slice(0, 3))
  })

  it('writes items-blind.json as {id, task, evidence, A, B} and key.json as id → {itemId, A, B}', async () => {
    const { items, key, written } = await packet([disagreeing(1), disagreeing(2)])
    expect(Object.keys(written).sort()).toEqual(['/out/panel/items-blind.json', '/out/panel/key.json'])
    expect(items).toHaveLength(2)

    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(['A', 'B', 'evidence', 'id', 'task'])
      expect(item.task).toBe('detect')
      const entry = key[item.id]!
      expect([entry.A, entry.B].sort()).toEqual([CHALLENGER, INCUMBENT].sort())
      // The A/B answer matches the model the key names for it.
      const challengerSide = entry.A === CHALLENGER ? item.A : item.B
      expect(challengerSide).toEqual(json({ category: 'coffee' }))
    }

    const blindText = written['/out/panel/items-blind.json']!
    expect(blindText).not.toContain(CHALLENGER)
    expect(blindText).not.toContain(INCUMBENT)
    expect(blindText).not.toContain('span-replay-')
  })
})

describe('buildPanelPacket — determinism', () => {
  const rows = Array.from({ length: 20 }, (_, i) => disagreeing(i))
  const assignments = (key: PanelKey) =>
    Object.fromEntries(Object.values(key).map((k) => [k.itemId, k.A]))

  it('gives identical A/B for the same seed', async () => {
    const first = await packet(rows, { seed: 'seed-one' })
    const second = await packet(rows, { seed: 'seed-one' })
    expect(second.written).toEqual(first.written)
  })

  it('changes at least one assignment over 20 items for a different seed', async () => {
    const one = assignments((await packet(rows, { seed: 'seed-one' })).key)
    const two = assignments((await packet(rows, { seed: 'seed-two' })).key)
    expect(Object.keys(one)).toHaveLength(20)
    expect(two).not.toEqual(one)
  })
})
