import { appendFileSync } from 'node:fs'

/**
 * Diverts LLM audit rows from Postgres to a local JSONL file.
 *
 * Set `CURATION_EVAL_SINK=/abs/path.jsonl` and `insertAiCallResult` writes
 * there instead of inserting into `brand_ai_results`. This exists so a model
 * A/B run can execute the real pipeline against production *reads* without
 * leaving a single row behind — the audit insert is the one write that no
 * `dryRun` branch suppresses, because auditing a call you actually made is
 * normally the correct behaviour.
 *
 * Writes are synchronous on purpose. The alternative is an async append racing
 * process exit, which silently truncates the last few calls of a run — and the
 * whole point of the sink is that its record is complete enough to bill from.
 */
export function evalSinkPath(): string | null {
  const path = process.env.CURATION_EVAL_SINK?.trim()
  return path && path.length > 0 ? path : null
}

export type EvalSinkRecord = {
  at: string
  target: { type: string; id: string }
  phase: string
  model: string
  latencyMs: number
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null
  ok: boolean
  status: number | null
  error: string | null
}

/** Pulls the audit envelope written by llm-audit.ts back apart. */
function readEnvelope(rawResponse: unknown): {
  usage: EvalSinkRecord['usage']
  ok: boolean
  status: number | null
  error: string | null
} {
  if (!rawResponse || typeof rawResponse !== 'object') {
    return { usage: null, ok: false, status: null, error: 'unreadable audit envelope' }
  }
  const envelope = rawResponse as {
    ok?: unknown
    status?: unknown
    error?: unknown
    usage?: EvalSinkRecord['usage']
    response?: { usage?: EvalSinkRecord['usage'] }
  }
  return {
    // `usage` is hoisted to the envelope by llm-audit, but only on success; the
    // raw response still carries it, so fall back rather than reporting zero
    // tokens for a call that definitely spent some.
    usage: envelope.usage ?? envelope.response?.usage ?? null,
    ok: envelope.ok === true,
    status: typeof envelope.status === 'number' ? envelope.status : null,
    error: typeof envelope.error === 'string' ? envelope.error : null,
  }
}

export function writeEvalSinkRecord(input: {
  path: string
  target: { type: string; id: string }
  phase: string
  model: string
  latencyMs: number
  rawResponse: unknown
}): void {
  const envelope = readEnvelope(input.rawResponse)
  const record: EvalSinkRecord = {
    at: new Date().toISOString(),
    target: input.target,
    phase: input.phase,
    model: input.model,
    latencyMs: Math.round(input.latencyMs),
    ...envelope,
  }
  appendFileSync(input.path, `${JSON.stringify(record)}\n`)
}
