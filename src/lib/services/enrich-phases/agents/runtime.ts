/**
 * Shared runtime for the curation agents (acquisition, products, editorial).
 *
 * Before this module each graph carried its own `callModel`, `extractJson`,
 * `withSchema` and JSON-Schema converter, and the acquisition bridge wrote agent
 * turns with no cost, no token counts, no jobId and no subjectId — and wrote
 * nothing at all when a turn threw (DEV-1644 F15). There is one implementation
 * here so a fix lands once for every agent.
 *
 * The audit contract mirrors `llm-audit.ts`'s `createAuditedOpenAIClient`: the
 * `auditedCall` envelope carries attribution and cost, `persistAuditEvent`
 * writes the `brand_ai_results` row, and `emitLangfuseGeneration` reports the
 * generation. The difference is the transport — LangChain models rather than the
 * OpenAI client — which is why this cannot simply call that helper.
 */

import { randomUUID } from 'node:crypto'
import type { BaseMessage } from '@langchain/core/messages'
import type { z } from 'zod'
import { auditedCall, type ChatAuditEvent } from '@/lib/audit'
import {
  persistAuditEvent,
  emitLangfuseGeneration,
  type LlmAuditContext,
} from '@/lib/services/llm-audit'
import { priceUsage } from '@/lib/services/llm-pricing'
import {
  LLM_PROFILES,
  resolveProfileModel,
  type LlmProfile,
  type LlmProfileKey,
} from '@/lib/constants/llm-models'
import { toStrictJsonSchema } from '../../_shared/zod-schema'

// ---------------------------------------------------------------------------
// Model surface
// ---------------------------------------------------------------------------

/**
 * What the agents need from a chat model. Narrower than `BaseChatModel` on
 * purpose: a test fake is an object literal, and a graph that only needs
 * `invoke`/`bindTools` should not force one.
 */
export type AgentModelResponse = {
  content: unknown
  tool_calls?: Array<{ name: string; args: Record<string, unknown>; id?: string }>
  usage_metadata?: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
  }
}

/**
 * Method shorthand, not property syntax, is load-bearing: it keeps parameter
 * checking bivariant so a real `ChatOpenAI` (whose `invoke` takes the wider
 * `BaseLanguageModelInput`) satisfies this type without a cast at the call site.
 */
export type AgentModel = {
  invoke(
    messages: BaseMessage[],
    options?: { signal?: AbortSignal },
  ): Promise<AgentModelResponse>
  /**
   * Present on real chat models and on tool-loop fakes. Absent on a plain
   * `RunnableLambda`, which is how a caller signals "no tool loop".
   */
  bindTools?(tools: readonly unknown[]): AgentModel
}

export type AgentAuditContext = {
  /** Required, with no default: a wrong phase string silently orphans the row. */
  phase: string
  jobId?: string
  target?: LlmAuditContext['target']
  attempt?: number
  supabase?: LlmAuditContext['supabase']
  /** Resolved model name recorded on the audit row and priced against. */
  modelName?: string
  /** Extra fields merged into the audit span summary. */
  summary?: Record<string, unknown>
  signal?: AbortSignal
  _persistAuditEvent?: typeof persistAuditEvent
  _emitLangfuseGeneration?: typeof emitLangfuseGeneration
}

/**
 * A chat model pinned to a phase's profile.
 *
 * Async because `@langchain/openai` is loaded on demand: the agents are worker
 * code, and a static import would pull the OpenAI SDK into every bundle that
 * transitively reaches `curation-operations.ts`.
 *
 * Deliberately does NOT set `response_format: json_object`. OpenAI refuses a
 * forced JSON response alongside tool definitions, and the acquisition plan node
 * binds four tools. Structure comes from the tool schemas and from the JSON
 * Schema `withSchema` inlines; `extractJson` absorbs a fenced reply.
 */
export async function createAgentModel(
  profileKey: LlmProfileKey,
  options: { jsonObject?: boolean } = {},
): Promise<AgentModel> {
  const { ChatOpenAI } = await import('@langchain/openai')
  // Widened to `LlmProfile` because the registry's `as const` gives a union in
  // which not every member declares `timeoutMs` (same reason as profileChatParams).
  const profile: LlmProfile = LLM_PROFILES[profileKey]

  // gpt-5 chat completions accept a temperature only alongside reasoning_effort
  // 'none' (same rule as openai-client.ts).
  return new ChatOpenAI({
    model: resolveProfileModel(profileKey),
    temperature: profile.temperature,
    ...(profile.timeoutMs ? { timeout: profile.timeoutMs } : {}),
    maxRetries: 1,
    modelKwargs: {
      reasoning_effort: profile.reasoningEffort ?? 'none',
      ...(options.jsonObject ? { response_format: { type: 'json_object' } } : {}),
    },
  })
}

// ---------------------------------------------------------------------------
// Audited model turn
// ---------------------------------------------------------------------------

type MessageLike = {
  role?: string
  content: unknown
  _getType?: () => string
}

function roleOf(message: MessageLike): string {
  if (message.role) return message.role
  const type = message._getType?.()
  return type === 'human' ? 'user' : (type ?? 'user')
}

function textOf(message: MessageLike | undefined): string {
  if (!message) return ''
  return typeof message.content === 'string'
    ? message.content
    : JSON.stringify(message.content ?? '')
}

/**
 * One audited model turn. Every agent turn goes through here, so every agent
 * turn gets tokens, cost, subject and job attribution — on success AND on
 * failure. A turn that throws still writes its row: a phase that fails on its
 * first call used to leave no trace at all.
 */
export async function callModel(
  model: AgentModel,
  messages: BaseMessage[],
  audit: AgentAuditContext,
): Promise<AgentModelResponse> {
  const spanId = randomUUID()
  const startMs = Date.now()
  const modelName = audit.modelName ?? 'agent-model'
  const persist = audit._persistAuditEvent ?? persistAuditEvent
  const emit = audit._emitLangfuseGeneration ?? emitLangfuseGeneration

  const auditCtx: LlmAuditContext = {
    phase: audit.phase,
    ...(audit.jobId ? { jobId: audit.jobId } : {}),
    ...(audit.target ? { target: audit.target } : {}),
    ...(audit.attempt !== undefined ? { attempt: audit.attempt } : {}),
    ...(audit.supabase ? { supabase: audit.supabase } : {}),
  }

  const request = {
    system: textOf(messages.find((m) => roleOf(m as MessageLike) === 'system') as MessageLike | undefined),
    user: textOf(messages.find((m) => roleOf(m as MessageLike) === 'user') as MessageLike | undefined),
    imageCount: 0,
  }

  return auditedCall(
    {
      provider: 'openai',
      operation: 'chat_completions',
      kind: 'external',
      spanId,
      ...(audit.attempt !== undefined ? { attempt: audit.attempt } : {}),
    },
    async (ctx) => {
      try {
        const response = await model.invoke(
          messages,
          audit.signal ? { signal: audit.signal } : undefined,
        )
        const latencyMs = Date.now() - startMs

        const usage = response.usage_metadata
        const chatUsage = usage
          ? {
              prompt_tokens: usage.input_tokens,
              completion_tokens: usage.output_tokens,
              total_tokens: usage.total_tokens,
            }
          : undefined

        if (chatUsage) {
          try {
            const cost = await priceUsage(modelName, chatUsage)
            ctx.promptTokens = cost.promptTokens
            ctx.completionTokens = cost.completionTokens
            ctx.costUsd = cost.costUsd
          } catch {
            // Price lookup must never prevent the audit row from being written.
          }
        }

        const event: ChatAuditEvent = {
          provider: 'openai',
          model: modelName,
          ok: true,
          status: 200,
          data: response.content,
          ...(chatUsage ? { usage: chatUsage } : {}),
          latencyMs,
          request,
        }

        await persist(auditCtx, event, spanId)
        emit(auditCtx, event)
        return response
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const event: ChatAuditEvent = {
          provider: 'openai',
          model: modelName,
          ok: false,
          status: 0,
          data: null,
          latencyMs: Date.now() - startMs,
          request,
          error: message,
        }
        await persist(auditCtx, event, spanId)
        emit(auditCtx, event)
        throw error
      }
    },
    {
      summary: {
        phase: audit.phase,
        ...(audit.target ? { targetType: audit.target.type } : {}),
        ...(audit.summary ?? {}),
      },
      subjectId: audit.target?.id ?? null,
      jobId: audit.jobId ?? null,
    },
  )
}

// ---------------------------------------------------------------------------
// Prompt and parsing helpers
// ---------------------------------------------------------------------------

/** Appended after an inlined JSON Schema block in every agent prompt. */
export const SCHEMA_TRAILER =
  'Output only a JSON object that matches this schema. Do not add fields the schema does not define.'

/**
 * The prompts say "match the <name> JSON Schema" — this is what makes that
 * sentence true. Without the schema inline the model invents field names and
 * strict Zod rejects every payload.
 */
export function withSchema(
  prompt: string,
  name: string,
  schema: z.ZodType,
  trailer: string = SCHEMA_TRAILER,
): string {
  return `${prompt}\n\n## ${name} JSON Schema\n\`\`\`json\n${JSON.stringify(toStrictJsonSchema(schema))}\n\`\`\`\n${trailer}`
}

/** Models sometimes wrap JSON in a ```json fence even under json_object mode. */
export function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  return (fenced?.[1] ?? text).trim()
}

/**
 * Combines the caller's signal with the agent's own wall-clock deadline.
 * Returns `undefined` when there is nothing to abort on, so call sites can pass
 * the result straight through without a conditional.
 */
export function withSignal(
  ...signals: Array<AbortSignal | undefined>
): AbortSignal | undefined {
  const present = signals.filter((signal): signal is AbortSignal => signal != null)
  if (present.length === 0) return undefined
  if (present.length === 1) return present[0]
  return AbortSignal.any(present)
}

/** The text content of a model response, whatever shape the model returned. */
export function contentText(response: AgentModelResponse): string {
  return typeof response.content === 'string'
    ? response.content
    : JSON.stringify(response.content)
}
