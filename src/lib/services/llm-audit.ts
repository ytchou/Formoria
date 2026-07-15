import { insertAiCallResult } from './ai-results'
import {
  createDeepSeekClient,
  type ChatAuditEvent as DeepSeekAuditEvent,
} from './deepseek-client'
import type { EnrichmentTarget } from './enrichment-target'
import { createOpenAIClient, type ChatAuditEvent as OpenAiAuditEvent } from './openai-client'

const MAX_PROMPT_LENGTH = 2_000

export type LlmAuditContext = {
  jobId?: string
  target: EnrichmentTarget
  phase: string
  attempt?: number
  config?: unknown
}

type ClientOptions = {
  apiKey?: string
  model?: string
}

type AuditEvent = DeepSeekAuditEvent | OpenAiAuditEvent

function truncate(value: string): string {
  return value.length <= MAX_PROMPT_LENGTH ? value : `${value.slice(0, MAX_PROMPT_LENGTH)}…`
}

async function persistAuditEvent(context: LlmAuditContext, event: AuditEvent): Promise<void> {
  try {
    await insertAiCallResult({
      target: context.target,
      phase: context.phase,
      model: event.model,
      ...(context.jobId ? { jobId: context.jobId } : {}),
      rawResponse: {
        provider: event.provider,
        ok: event.ok,
        status: event.status,
        response: event.data,
        ...(event.usage ? { usage: event.usage } : {}),
        ...(event.error ? { error: event.error } : {}),
      },
      input: {
        system: truncate(event.request.system),
        user: truncate(event.request.user),
        imageCount: event.request.imageCount,
        ...(event.meta ? { meta: event.meta } : {}),
      },
      ...(context.attempt !== undefined ? { attempt: context.attempt } : {}),
      ...(context.config !== undefined ? { config: context.config } : {}),
      latencyMs: event.latencyMs,
    })
  } catch (error) {
    console.error('[llm-audit:persist]', { error: error instanceof Error ? error.message : String(error) })
  }
}

export function createAuditedDeepSeekClient(context: LlmAuditContext, options: ClientOptions = {}) {
  return createDeepSeekClient({
    ...options,
    onChatComplete: (event) => persistAuditEvent(context, event),
  })
}

export function createAuditedOpenAIClient(context: LlmAuditContext, options: ClientOptions = {}) {
  return createOpenAIClient({
    ...options,
    onChatComplete: (event) => persistAuditEvent(context, event),
  })
}
