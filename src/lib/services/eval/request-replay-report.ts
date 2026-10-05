/**
 * Report + panel packet for `llm-eval replay` (DEV-1917, design D2, D10, D12).
 *
 * - `buildStepTable`: one markdown comparison table per replayed step, plus
 *   the stats behind it for the run JSON.
 * - `buildPanelPacket`: spans where the challenger disagrees on a key field or
 *   changed prose, exported as a blind A/B packet (`items-blind.json` +
 *   `key.json`) for manual judging.
 *
 * Both consume `ReplaySpanResult`, which the orchestrator builds per span.
 */

import { createHash } from 'node:crypto'
import { join } from 'node:path'

import { listPriceCost, type TokenCounts } from './list-prices'
import { blind } from './pairwise'
import type { NormalizedResponse, ReplayScore } from './request-replay-score'
import { mean, p50, p95 } from './scorers'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** D2: a step with fewer spans is flagged UNDER-POWERED. */
export const UNDER_POWERED_MIN_SPANS = 30

/** D10: default `--panel-max`, per step. */
export const DEFAULT_PANEL_MAX = 30

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type ReplaySkipReason = 'image' | 'prod-failed' | 'unclassified'

/** One arm's call for one span. */
export type ReplayArmResult = {
  model: string
  /** Null when the call failed. */
  output: NormalizedResponse | null
  /** Score against the stored answer; null when the call failed. */
  score: ReplayScore | null
  latencyMs: number
  /** DB-priced cost, including `runItems`' retry; null when the model has no DB price. */
  costUsd: number | null
  /** Token counts for the list-price fallback; null when unknown. */
  tokens: TokenCounts | null
  failure: string | null
  offSlot: boolean
  paramFallback: boolean
}

/** One logged span after replay. */
export type ReplaySpanResult = {
  spanId: string
  step: string
  /** `brand_id`, else the submission's brand, else a per-submission key. */
  brandKey: string
  /** The model that produced the stored answer. */
  storedModel: string
  /** The stored production answer; null for a skipped span. */
  expected: NormalizedResponse | null
  /** What the judges see as the task input. */
  evidence: unknown
  /** Set when the span was not replayed; both arms are then null. */
  skip: ReplaySkipReason | null
  challenger: ReplayArmResult | null
  /** The noise-floor arm: the stored model re-run. */
  incumbent: ReplayArmResult | null
}

// ---------------------------------------------------------------------------
// Step table
// ---------------------------------------------------------------------------

export type StepStats = {
  step: string
  spans: number
  distinctBrands: number
  underPowered: boolean
  challengerAgreement: number | null
  noiseFloorAgreement: number | null
  /** Challenger key-field agreement. */
  keyAgreement: number | null
  /** Share of spans with prose fields where the challenger changed at least one. */
  proseChangedPct: number | null
  /** Challenger latency over successful calls. */
  latencyP50Ms: number | null
  latencyP95Ms: number | null
  /** Challenger $/call. */
  costPerCall: { usd: number; source: 'db' | 'list' } | null
  /** Failures, off-slot calls and paramFallbacks are counted over both arms. */
  failures: number
  offSlot: number
  paramFallback: number
  skips: Record<ReplaySkipReason, number>
}

export type StepTable = { stats: StepStats; markdown: string }

const COLUMNS = [
  'spans',
  'distinct brands',
  'challenger agreement',
  'noise-floor agreement',
  'key-field agreement',
  'prose changed',
  'p50 latency',
  'p95 latency',
  '$/call',
  'failures',
  'off-slot',
  'paramFallback',
  'skips',
] as const

function meanOrNull(values: number[]): number | null {
  return values.length === 0 ? null : mean(values)
}

function nonNull<T>(values: Array<T | null | undefined>): T[] {
  return values.filter((v): v is T => v !== null && v !== undefined)
}

function challengerCost(arms: ReplayArmResult[]): StepStats['costPerCall'] {
  if (arms.length === 0) return null
  const db = nonNull(arms.map((a) => a.costUsd))
  if (db.length === arms.length) return { usd: mean(db), source: 'db' }

  // Off-slot calls were billed at another model's price: excluded, as in
  // run-experiment.ts.
  const onSlot = arms.filter((a) => !a.offSlot)
  const list = onSlot.map((a) => (a.tokens ? listPriceCost(a.tokens, a.model) : null))
  if (list.length === 0 || list.some((c) => c === null)) return null
  return { usd: mean(list as number[]), source: 'list' }
}

const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`)
const ms = (v: number | null) => (v === null ? '—' : `${Math.round(v)} ms`)

export function buildStepTable(step: string, spans: ReplaySpanResult[]): StepTable {
  const challengers = nonNull(spans.map((s) => s.challenger))
  const incumbents = nonNull(spans.map((s) => s.incumbent))
  const allArms = [...challengers, ...incumbents]
  const okChallengers = challengers.filter((a) => a.failure === null)
  const challengerScores = nonNull(challengers.map((a) => a.score))
  const latencies = okChallengers.map((a) => a.latencyMs)
  const withProse = challengerScores.filter((s) => s.prose.length > 0)

  const skips: Record<ReplaySkipReason, number> = { image: 0, 'prod-failed': 0, unclassified: 0 }
  for (const s of spans) if (s.skip) skips[s.skip]++

  const stats: StepStats = {
    step,
    spans: spans.length,
    distinctBrands: new Set(spans.map((s) => s.brandKey)).size,
    underPowered: spans.length < UNDER_POWERED_MIN_SPANS,
    challengerAgreement: meanOrNull(nonNull(challengerScores.map((s) => s.agreement))),
    noiseFloorAgreement: meanOrNull(
      nonNull(nonNull(incumbents.map((a) => a.score)).map((s) => s.agreement)),
    ),
    keyAgreement: meanOrNull(nonNull(challengerScores.map((s) => s.keyAgreement))),
    proseChangedPct:
      withProse.length === 0
        ? null
        : withProse.filter((s) => s.prose.some((p) => p.changed)).length / withProse.length,
    latencyP50Ms: latencies.length === 0 ? null : p50(latencies),
    latencyP95Ms: latencies.length === 0 ? null : p95(latencies),
    costPerCall: challengerCost(okChallengers),
    failures: allArms.filter((a) => a.failure !== null).length,
    offSlot: allArms.filter((a) => a.offSlot).length,
    paramFallback: allArms.filter((a) => a.paramFallback).length,
    skips,
  }

  const cost = stats.costPerCall
  const row = [
    `n=${stats.spans}`,
    String(stats.distinctBrands),
    pct(stats.challengerAgreement),
    pct(stats.noiseFloorAgreement),
    pct(stats.keyAgreement),
    pct(stats.proseChangedPct),
    ms(stats.latencyP50Ms),
    ms(stats.latencyP95Ms),
    cost === null ? 'n/a' : `$${cost.usd.toFixed(6)}${cost.source === 'list' ? ' (list)' : ''}`,
    String(stats.failures),
    String(stats.offSlot),
    String(stats.paramFallback),
    `image ${skips.image}, prod-failed ${skips['prod-failed']}, unclassified ${skips.unclassified}`,
  ]

  const title = stats.underPowered
    ? `### ${step} — UNDER-POWERED (n=${stats.spans} < ${UNDER_POWERED_MIN_SPANS})`
    : `### ${step}`
  const markdown = [
    title,
    '',
    `| ${COLUMNS.join(' | ')} |`,
    `|${COLUMNS.map(() => '---').join('|')}|`,
    `| ${row.join(' | ')} |`,
  ].join('\n')

  return { stats, markdown }
}

// ---------------------------------------------------------------------------
// Panel packet
// ---------------------------------------------------------------------------

export type PanelBlindItem = {
  id: string
  task: string
  evidence: unknown
  A: NormalizedResponse
  B: NormalizedResponse
}

/** Blind item id → the span and the model behind each side. */
export type PanelKey = Record<string, { itemId: string; A: string; B: string }>

export type BuildPanelPacketInput = {
  spans: ReplaySpanResult[]
  /** Cap per step. */
  panelMax: number
  seed: string
  outDir: string
  writeFile: (path: string, content: string) => Promise<void>
}

export type PanelPacket = { items: PanelBlindItem[]; key: PanelKey }

const md5hex = (s: string) => createHash('md5').update(s).digest('hex')

function needsPanel(span: ReplaySpanResult): boolean {
  const score = span.challenger?.score
  if (span.skip || !span.expected || !span.challenger?.output || !score) return false
  const keyDisagrees = score.keyAgreement !== null && score.keyAgreement < 1
  return keyDisagrees || score.prose.some((p) => p.changed)
}

export async function buildPanelPacket(input: BuildPanelPacketInput): Promise<PanelPacket> {
  const byStep = new Map<string, ReplaySpanResult[]>()
  for (const s of input.spans.filter(needsPanel)) {
    byStep.set(s.step, [...(byStep.get(s.step) ?? []), s])
  }

  const items: PanelBlindItem[] = []
  const key: PanelKey = {}
  for (const [step, group] of byStep) {
    const picked = group
      .map((s) => ({ s, h: md5hex(s.spanId) }))
      .sort((x, y) => (x.h < y.h ? -1 : x.h > y.h ? 1 : 0))
      .slice(0, input.panelMax)

    picked.forEach(({ s }, i) => {
      const id = `${step}-${String(i + 1).padStart(2, '0')}`
      const rng = () => parseInt(md5hex(input.seed + s.spanId).slice(0, 8), 16) / 2 ** 32
      const { left, right } = blind(
        { model: s.challenger!.model, output: s.challenger!.output! },
        { model: s.storedModel, output: s.expected! },
        rng,
      )
      items.push({ id, task: step, evidence: s.evidence, A: left.output, B: right.output })
      key[id] = { itemId: s.spanId, A: left.model, B: right.model }
    })
  }

  await input.writeFile(join(input.outDir, 'items-blind.json'), JSON.stringify(items, null, 2))
  await input.writeFile(join(input.outDir, 'key.json'), JSON.stringify(key, null, 2))
  return { items, key }
}
