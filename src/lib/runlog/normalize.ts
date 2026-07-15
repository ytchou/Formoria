import {
  RUNLOG_SCHEMA_VERSION,
  type ActorKind,
  type CostEstimate,
  type EventStatus,
  type Phase,
  type PhaseKind,
  type PhaseStatus,
  type Producer,
  type RunLog,
  type RunStatus,
  type StepEvent,
  type SummaryChip,
  type TokenUsage,
} from './schema'

type UnknownRecord = Record<string, unknown>

const RUN_STATUSES = new Set<RunStatus>(['queued', 'running', 'completed', 'failed', 'cancelled', 'unknown'])
const PHASE_STATUSES = new Set<PhaseStatus>(['pending', 'running', 'succeeded', 'failed', 'skipped', 'unknown'])
const EVENT_STATUSES = new Set<EventStatus>(['ok', 'error', 'warning', 'unknown'])
const ACTORS = new Set<ActorKind>(['LLM', 'HTTP', 'SCRAPE', 'DB', 'STORAGE', 'SCRIPT', 'AGENT', 'SYSTEM'])
const PHASE_KINDS = new Set<PhaseKind>([
  'setup',
  'search',
  'llm',
  'scrape',
  'transform',
  'io',
  'persist',
  'mixed',
  'unknown',
])

function record(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as UnknownRecord) : null
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringMap(value: unknown): Record<string, string> | undefined {
  const source = record(value)
  if (!source) return undefined

  return Object.fromEntries(Object.entries(source).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

function numberMap(value: unknown): Record<string, number> | undefined {
  const source = record(value)
  if (!source) return undefined

  return Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])),
  )
}

function tokens(value: unknown): TokenUsage | undefined {
  const source = record(value)
  if (!source) return undefined

  const normalized = {
    input: number(source.input),
    output: number(source.output),
    total: number(source.total),
  }
  return Object.values(normalized).some((entry) => entry !== undefined) ? normalized : undefined
}

function cost(value: unknown): CostEstimate | undefined {
  const source = record(value)
  const amount = number(source?.amount)
  const currency = string(source?.currency)
  return amount === undefined || currency === undefined ? undefined : { amount, currency }
}

function enumValue<T extends string>(
  value: unknown,
  values: Set<T>,
  fallback: T,
  path: string,
  gaps: string[],
): T {
  if (typeof value === 'string' && values.has(value as T)) return value as T
  gaps.push(`${path} is missing or unsupported`)
  return fallback
}

function producer(value: unknown, fallbackName: string): Producer {
  const source = record(value)
  return {
    name: string(source?.name) ?? fallbackName,
    ...(string(source?.version) ? { version: string(source?.version) } : {}),
  }
}

function event(value: unknown, path: string, gaps: string[]): StepEvent {
  const source = record(value)
  if (!source) gaps.push(`${path} is not an object`)

  return {
    ...(string(source?.timestamp) ? { timestamp: string(source?.timestamp) } : {}),
    actor: enumValue(source?.actor, ACTORS, 'SYSTEM', `${path}.actor`, gaps),
    ...(string(source?.name) ? { name: string(source?.name) } : {}),
    summary: string(source?.summary) ?? 'Unknown event',
    status: enumValue(source?.status, EVENT_STATUSES, 'unknown', `${path}.status`, gaps),
    ...(string(source?.model) ? { model: string(source?.model) } : {}),
    ...(tokens(source?.tokens) ? { tokens: tokens(source?.tokens) } : {}),
    ...(number(source?.latencyMs) !== undefined ? { latencyMs: number(source?.latencyMs) } : {}),
    ...(cost(source?.cost) ? { cost: cost(source?.cost) } : {}),
    ...(stringMap(source?.labels) ? { labels: stringMap(source?.labels) } : {}),
    ...(string(source?.payloadRef) ? { payloadRef: string(source?.payloadRef) } : {}),
    ...(string(source?.error) ? { error: string(source?.error) } : {}),
  }
}

function phase(value: unknown, index: number, gaps: string[]): Phase {
  const source = record(value)
  const path = `phases[${index}]`
  if (!source) gaps.push(`${path} is not an object`)
  const events = Array.isArray(source?.events)
    ? source.events.map((entry, eventIndex) => event(entry, `${path}.events[${eventIndex}]`, gaps))
    : []

  return {
    index: number(source?.index) ?? index + 1,
    name: string(source?.name) ?? `phase-${index + 1}`,
    kind: enumValue(source?.kind, PHASE_KINDS, 'unknown', `${path}.kind`, gaps),
    status: enumValue(source?.status, PHASE_STATUSES, 'unknown', `${path}.status`, gaps),
    ...(string(source?.summary) ? { summary: string(source?.summary) } : {}),
    ...(number(source?.durationMs) !== undefined ? { durationMs: number(source?.durationMs) } : {}),
    ...(number(source?.barWeight) !== undefined ? { barWeight: number(source?.barWeight) } : {}),
    ...(numberMap(source?.counts) ? { counts: numberMap(source?.counts) } : {}),
    ...(tokens(source?.tokens) ? { tokens: tokens(source?.tokens) } : {}),
    events,
    ...(number(source?.eventsTruncated) !== undefined ? { eventsTruncated: number(source?.eventsTruncated) } : {}),
  }
}

function chip(value: unknown): SummaryChip | null {
  const source = record(value)
  const label = string(source?.label)
  const chipValue = string(source?.value)
  if (!label || chipValue === undefined) return null

  const tone = source?.tone
  return {
    label,
    value: chipValue,
    ...(tone === 'neutral' || tone === 'success' || tone === 'warning' || tone === 'danger' ? { tone } : {}),
  }
}

function normalize(input: unknown): RunLog {
  const gaps: string[] = []
  const root = record(input)
  if (!root) gaps.push('runlog root is not an object')

  const run = record(root?.run)
  if (!run) gaps.push('run is missing or invalid')

  const phases = Array.isArray(root?.phases)
    ? root.phases.map((entry, index) => phase(entry, index, gaps))
    : (gaps.push('phases is missing or invalid'), [])
  const summary = record(root?.summary)
  const provenance = record(root?.provenance)
  const extraChips = Array.isArray(summary?.extraChips)
    ? summary.extraChips.map(chip).filter((entry): entry is SummaryChip => entry !== null)
    : undefined
  const suppliedGaps = Array.isArray(root?.gaps) ? root.gaps.filter((entry): entry is string => typeof entry === 'string') : []

  return {
    schemaVersion: string(root?.schemaVersion) ?? RUNLOG_SCHEMA_VERSION,
    run: {
      id: string(run?.id) ?? 'unknown',
      workflow: string(run?.workflow) ?? 'unknown',
      status: enumValue(run?.status, RUN_STATUSES, 'unknown', 'run.status', gaps),
      ...(string(run?.trigger) ? { trigger: string(run?.trigger) } : {}),
      ...(string(run?.actor) ? { actor: string(run?.actor) } : {}),
      ...(string(run?.startedAt) ? { startedAt: string(run?.startedAt) } : {}),
      ...(string(run?.completedAt) ? { completedAt: string(run?.completedAt) } : {}),
      ...(string(run?.error) ? { error: string(run?.error) } : {}),
      ...(number(run?.attempt) !== undefined ? { attempt: number(run?.attempt) } : {}),
      ...(string(run?.parentRunId) ? { parentRunId: string(run?.parentRunId) } : {}),
      ...(stringMap(run?.labels) ? { labels: stringMap(run?.labels) } : {}),
    },
    summary: {
      phaseCount: number(summary?.phaseCount) ?? phases.length,
      ...(number(summary?.durationMs) !== undefined ? { durationMs: number(summary?.durationMs) } : {}),
      ...(number(summary?.callCount) !== undefined ? { callCount: number(summary?.callCount) } : {}),
      ...(number(summary?.queryCount) !== undefined ? { queryCount: number(summary?.queryCount) } : {}),
      ...(tokens(summary?.tokens) ? { tokens: tokens(summary?.tokens) } : {}),
      ...(cost(summary?.cost) ? { cost: cost(summary?.cost) } : {}),
      ...(numberMap(summary?.outcomes) ? { outcomes: numberMap(summary?.outcomes) } : {}),
      ...(extraChips ? { extraChips } : {}),
    },
    phases,
    provenance: {
      producer: producer(provenance?.producer, 'unknown'),
      ...(Array.isArray(provenance?.components)
        ? { components: provenance.components.map((entry) => producer(entry, 'unknown')) }
        : {}),
      ...(string(provenance?.sourceRef) ? { sourceRef: string(provenance?.sourceRef) } : {}),
      generatedAt: string(provenance?.generatedAt) ?? new Date(0).toISOString(),
    },
    ...(gaps.length || suppliedGaps.length ? { gaps: [...suppliedGaps, ...gaps] } : {}),
  }
}

export function coerceRunLog(input: unknown): RunLog {
  try {
    return normalize(input)
  } catch {
    return normalize(null)
  }
}
