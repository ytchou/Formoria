/**
 * Audit bridge for the acquisition agent. Wraps LangChain model invocations
 * with the project's `auditedCall` envelope and persists LLM audit events
 * to `brand_ai_results` + Langfuse.
 *
 * Does NOT use LangChain's BaseCallbackHandler — the project's audit layer
 * predates LangChain and the overhead of adapting the callback protocol is not
 * justified for a single call site.
 */

import { randomUUID } from 'node:crypto'
import { auditedCall } from '@/lib/audit'
import type { ChatAuditEvent } from '@/lib/audit'
import {
  persistAuditEvent,
  emitLangfuseGeneration,
  type LlmAuditContext,
} from '@/lib/services/llm-audit'

export type AuditBridgeContext = {
  phase: string
  jobId?: string
  target?: LlmAuditContext['target']
  attempt?: number
  supabase?: LlmAuditContext['supabase']
  /** Resolved model name recorded on the audit row; defaults to a placeholder. */
  modelName?: string
  _persistAuditEvent?: typeof persistAuditEvent
  _emitLangfuseGeneration?: typeof emitLangfuseGeneration
}

/**
 * Accepts either plain `{ role, content }` messages or LangChain
 * `BaseMessage` instances (which expose the role via `_getType()`).
 */
type LangChainMessage = {
  role?: 'system' | 'user' | 'assistant'
  content: unknown
  _getType?: () => string
}

function roleOf(message: LangChainMessage): string {
  if (message.role) return message.role
  const type = message._getType?.()
  return type === 'human' ? 'user' : (type ?? 'user')
}

function textOf(message: LangChainMessage | undefined): string {
  if (!message) return ''
  return typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? '')
}

type LangChainModel = {
  invoke: (messages: unknown[]) => Promise<{
    content: unknown
    usage_metadata?: {
      input_tokens?: number
      output_tokens?: number
      total_tokens?: number
    }
  }>
}

/**
 * Invokes a LangChain model with audit instrumentation. Wraps the call in
 * `auditedCall`, persists the audit event, and emits Langfuse generation data.
 */
export async function invokeAudited(
  model: LangChainModel,
  messages: LangChainMessage[],
  ctx: AuditBridgeContext,
): Promise<unknown> {
  const spanId = randomUUID()
  const startMs = Date.now()

  const auditCtx: LlmAuditContext = {
    phase: ctx.phase,
    jobId: ctx.jobId,
    target: ctx.target,
    attempt: ctx.attempt,
    supabase: ctx.supabase,
  }

  return auditedCall(
    {
      provider: 'openai',
      operation: 'chat_completions',
      kind: 'external',
      spanId,
      ...(ctx.attempt !== undefined ? { attempt: ctx.attempt } : {}),
    },
    async () => {
      const response = await model.invoke(messages)
      const latencyMs = Date.now() - startMs

      const usage = response.usage_metadata
      const event: ChatAuditEvent = {
        provider: 'openai',
        model: ctx.modelName ?? 'acquisition-agent',
        ok: true,
        status: 200,
        data: response.content,
        usage: usage ? {
          prompt_tokens: usage.input_tokens,
          completion_tokens: usage.output_tokens,
          total_tokens: usage.total_tokens,
        } : undefined,
        latencyMs,
        request: {
          system: textOf(messages.find((m) => roleOf(m) === 'system')),
          user: textOf(messages.find((m) => roleOf(m) === 'user')),
          imageCount: 0,
        },
      }

      const persist = ctx._persistAuditEvent ?? persistAuditEvent
      const emit = ctx._emitLangfuseGeneration ?? emitLangfuseGeneration
      await persist(auditCtx, event, spanId)
      emit(auditCtx, event)

      return response
    },
  )
}
