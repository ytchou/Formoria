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
import { meanOrNull, type NormalizedResponse, type ReplayScore } from './request-replay-score'
import { mean, p50, p95 } from './scorers'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** D2: a step with fewer scored (non-skipped) spans is flagged UNDER-POWERED. */
export const UNDER_POWERED_MIN_SPANS = 30

/** D10: default `--panel-max`, per step. */
export const DEFAULT_PANEL_MAX = 30

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

type ReplaySkipReason = 'image' | 'prod-failed'

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

/**
 * Challenger stats count only successful on-slot calls: an off-slot call was
 * answered (and billed) by another model, so its agreement, latency and cost
 * are not the challenger's. The same holds for the noise-floor arm.
 */
type StepStats = {
  step: string
  spans: number
  /** Spans not skipped; the under-powered test counts these. */
  scoredSpans: number
  distinctBrands: number
  underPowered: boolean
  challengerAgreement: number | null
  noiseFloorAgreement: number | null
  /** Challenger key-field agreement. */
  keyAgreement: number | null
  /** Noise-floor (incumbent re-run) key-field agreement. */
  noiseFloorKeyAgreement: number | null
  /** Share of spans with prose fields where the challenger changed at least one. */
  proseChangedPct: number | null
  /** Mean challenger/expected prose length ratio over prose fields with expected text. */
  proseLengthRatio: number | null
  /** Challenger number leaves: how many were compared, how many changed, and the abs delta over all of them. */
  numbers: { leaves: number; changed: number; meanAbsDelta: number | null; maxAbsDelta: number | null }
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
] as const

function nonNull<T>(values: Array<T | null | undefined>): T[] {
  return values.filter((v): v is T => v !== null && v !== undefined)
}

/** `arms` are successful on-slot calls: off-slot calls were billed at another model's price (as in run-experiment.ts). */
function challengerCost(arms: ReplayArmResult[]): StepStats['costPerCall'] {
  if (arms.length === 0) return null
  const db = nonNull(arms.map((a) => a.costUsd))
  if (db.length === arms.length) return { usd: mean(db), source: 'db' }

  const list = arms.map((a) => (a.tokens ? listPriceCost(a.tokens, a.model) : null))
  if (list.some((c) => c === null)) return null
  return { usd: mean(list as number[]), source: 'list' }
}

function numberStats(scores: ReplayScore[]): StepStats['numbers'] {
  const deltas = scores.flatMap((s) => s.numberDeltas.map((d) => d.absDelta))
  return {
    leaves: deltas.length,
    changed: deltas.filter((d) => d > 0).length,
    meanAbsDelta: meanOrNull(deltas),
    maxAbsDelta: deltas.length === 0 ? null : Math.max(...deltas),
  }
}

function proseLengthRatio(scores: ReplayScore[]): number | null {
  const ratios = scores.flatMap((s) =>
    s.prose.filter((p) => p.expectedLength > 0).map((p) => p.candidateLength / p.expectedLength),
  )
  return meanOrNull(ratios)
}

const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`)
const ms = (v: number | null) => (v === null ? '—' : `${Math.round(v)} ms`)
const ratio = (v: number | null) => (v === null ? '—' : `${v.toFixed(2)}x`)
const delta = (v: number | null) => (v === null ? '—' : String(Number(v.toFixed(4))))

function numbersCell(n: StepStats['numbers']): string {
  if (n.leaves === 0) return '—'
  return `${n.changed}/${n.leaves} changed, mean Δ ${delta(n.meanAbsDelta)}, max Δ ${delta(n.maxAbsDelta)}`
}

export function buildStepTable(step: string, spans: ReplaySpanResult[]): StepTable {
  const challengers = nonNull(spans.map((s) => s.challenger))
  const incumbents = nonNull(spans.map((s) => s.incumbent))
  const allArms = [...challengers, ...incumbents]
  const ok = (a: ReplayArmResult) => a.failure === null && !a.offSlot
  const okChallengers = challengers.filter(ok)
  const challengerScores = nonNull(okChallengers.map((a) => a.score))
  const incumbentScores = nonNull(incumbents.filter(ok).map((a) => a.score))
  const latencies = okChallengers.map((a) => a.latencyMs)
  const withProse = challengerScores.filter((s) => s.prose.length > 0)

  const skips: Record<ReplaySkipReason, number> = { image: 0, 'prod-failed': 0 }
  for (const s of spans) if (s.skip) skips[s.skip]++
  const scoredSpans = spans.filter((s) => !s.skip).length

  const stats: StepStats = {
    step,
    spans: spans.length,
    scoredSpans,
    distinctBrands: new Set(spans.map((s) => s.brandKey)).size,
    underPowered: scoredSpans > 0 && scoredSpans < UNDER_POWERED_MIN_SPANS,
    challengerAgreement: meanOrNull(nonNull(challengerScores.map((s) => s.agreement))),
    noiseFloorAgreement: meanOrNull(nonNull(incumbentScores.map((s) => s.agreement))),
    keyAgreement: meanOrNull(nonNull(challengerScores.map((s) => s.keyAgreement))),
    noiseFloorKeyAgreement: meanOrNull(nonNull(incumbentScores.map((s) => s.keyAgreement))),
    proseChangedPct:
      withProse.length === 0
        ? null
        : withProse.filter((s) => s.prose.some((p) => p.changed)).length / withProse.length,
    proseLengthRatio: proseLengthRatio(challengerScores),
    numbers: numberStats(challengerScores),
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
    pct(stats.noiseFloorKeyAgreement),
    pct(stats.proseChangedPct),
    ratio(stats.proseLengthRatio),
    numbersCell(stats.numbers),
    ms(stats.latencyP50Ms),
    ms(stats.latencyP95Ms),
    cost === null ? 'n/a' : `$${cost.usd.toFixed(6)}${cost.source === 'list' ? ' (list)' : ''}`,
    String(stats.failures),
    String(stats.offSlot),
    String(stats.paramFallback),
    `image ${skips.image}, prod-failed ${skips['prod-failed']}`,
  ]

  const title =
    scoredSpans === 0
      ? `### ${step} — n=0`
      : stats.underPowered
        ? `### ${step} — UNDER-POWERED (n=${scoredSpans} < ${UNDER_POWERED_MIN_SPANS})`
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
  /** One step's spans. */
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
  const picked = input.spans
    .filter(needsPanel)
    .map((s) => ({ s, h: md5hex(s.spanId) }))
    .sort((x, y) => (x.h < y.h ? -1 : x.h > y.h ? 1 : 0))
    .slice(0, input.panelMax)

  const items: PanelBlindItem[] = []
  const key: PanelKey = {}
  picked.forEach(({ s }, i) => {
    const id = `${s.step}-${String(i + 1).padStart(2, '0')}`
    const rng = () => parseInt(md5hex(input.seed + s.spanId).slice(0, 8), 16) / 2 ** 32
    const { left, right } = blind(
      { model: s.challenger!.model, output: s.challenger!.output! },
      { model: s.storedModel, output: s.expected! },
      rng,
    )
    items.push({ id, task: s.step, evidence: s.evidence, A: left.output, B: right.output })
    key[id] = { itemId: s.spanId, A: left.model, B: right.model }
  })

  await input.writeFile(join(input.outDir, 'items-blind.json'), JSON.stringify(items, null, 2))
  await input.writeFile(join(input.outDir, 'key.json'), JSON.stringify(key, null, 2))
  return { items, key }
}
