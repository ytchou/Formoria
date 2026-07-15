export const RUNLOG_SCHEMA_VERSION = '1.0'

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown'
export type PhaseStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'unknown'
export type EventStatus = 'ok' | 'error' | 'warning' | 'unknown'
export type ActorKind = 'LLM' | 'HTTP' | 'SCRAPE' | 'DB' | 'STORAGE' | 'SCRIPT' | 'AGENT' | 'SYSTEM'
export type PhaseKind = 'setup' | 'search' | 'llm' | 'scrape' | 'transform' | 'io' | 'persist' | 'mixed' | 'unknown'

export type TokenUsage = {
  input?: number
  output?: number
  total?: number
}

export type CostEstimate = {
  amount: number
  currency: string
}

export type SummaryChip = {
  label: string
  value: string
  tone?: 'neutral' | 'success' | 'warning' | 'danger'
}

export type StepEvent = {
  timestamp?: string
  actor: ActorKind
  name?: string
  summary: string
  status: EventStatus
  model?: string
  tokens?: TokenUsage
  latencyMs?: number
  cost?: CostEstimate
  labels?: Record<string, string>
  payloadRef?: string
  error?: string
}

export type Phase = {
  index: number
  name: string
  kind: PhaseKind
  status: PhaseStatus
  summary?: string
  durationMs?: number
  barWeight?: number
  counts?: Record<string, number>
  tokens?: TokenUsage
  events: StepEvent[]
  eventsTruncated?: number
}

export type RunSummary = {
  durationMs?: number
  phaseCount: number
  callCount?: number
  queryCount?: number
  tokens?: TokenUsage
  cost?: CostEstimate
  outcomes?: Record<string, number>
  extraChips?: SummaryChip[]
}

export type Producer = {
  name: string
  version?: string
}

export type Provenance = {
  producer: Producer
  components?: Producer[]
  sourceRef?: string
  generatedAt: string
}

export type Run = {
  id: string
  workflow: string
  trigger?: string
  actor?: string
  status: RunStatus
  startedAt?: string
  completedAt?: string
  error?: string
  attempt?: number
  parentRunId?: string
  labels?: Record<string, string>
}

export type RunLog = {
  schemaVersion: string
  run: Run
  summary: RunSummary
  phases: Phase[]
  provenance: Provenance
  gaps?: string[]
}
