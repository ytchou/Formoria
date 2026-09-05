/**
 * Shared runtime for the curation agents (acquisition, products, editorial).
 *
 * Before this module each graph carried its own model call, `extractJson`,
 * `withSchema` and JSON-Schema converter, and the acquisition bridge wrote agent
 * turns with no cost, no token counts, no jobId and no subjectId — and wrote
 * nothing at all when a turn threw (DEV-1644 F15). There is one implementation
 * here so a fix lands once for every agent.
 *
 * The transport is the shared `openai-client.ts`, reached through
 * `createProfiledOpenAIClient`. The audit contract is NOT mirrored here: the
 * `auditedCall` envelope, the `brand_ai_results` row and the Langfuse
 * generation all belong to `llm-audit.ts`, which is why the audit context is
 * bound once at construction rather than passed per turn (DEV-1700).
 */

import type { z } from 'zod'
import type { ChatUsage } from '@/lib/audit'
import {
  createProfiledOpenAIClient,
  profileChatParams,
  type LlmAuditContext,
} from '@/lib/services/llm-audit'
import type {
  ChatMessage,
  ChatToolCall,
  ChatToolDefinition,
} from '@/lib/services/openai-client'
import type { LlmProfileKey } from '@/lib/constants/llm-models'
import { toStrictJsonSchema } from '../../_shared/zod-schema'

// ---------------------------------------------------------------------------
// Model surface
// ---------------------------------------------------------------------------

export type AgentModelResponse = {
  content: string | null
  toolCalls?: ChatToolCall[]
  usage?: ChatUsage
}

/**
 * What the agents need from a chat model. Narrower than any provider SDK on
 * purpose: a test fake is `{ invoke }` and nothing else. Method shorthand keeps
 * parameter checking bivariant, so a fake that ignores the options argument
 * still satisfies the type.
 */
export type AgentModel = {
  invoke(
    messages: ChatMessage[],
    options?: { signal?: AbortSignal; tools?: ChatToolDefinition[] },
  ): Promise<AgentModelResponse>
}

function messageOf(errorBody: unknown): string {
  if (errorBody && typeof errorBody === 'object') {
    const { error } = errorBody as { error?: unknown }
    if (error && typeof error === 'object') {
      const { message } = error as { message?: unknown }
      if (typeof message === 'string') return message
    }
  }
  return 'request failed'
}

/**
 * A chat model pinned to a phase's profile and to one audit context.
 *
 * Binding the audit context at construction is what removed the per-turn audit
 * wrapper: every request the returned model makes writes its `brand_ai_results`
 * row through the audited client, on success and on failure alike.
 *
 * `jsonObject` is dropped for a turn that passes tools — OpenAI refuses a forced
 * JSON response alongside tool definitions, and the client throws if both are
 * sent. Structure for those turns comes from the tool schemas and from the JSON
 * Schema `withSchema` inlines; `extractJson` absorbs a fenced reply.
 *
 * Async for the seam signature: callers already `await` it, and keeping the
 * promise leaves room for a lazily-loaded transport.
 */
export async function createAgentModel(
  profileKey: LlmProfileKey,
  audit: LlmAuditContext,
  options: { jsonObject?: boolean } = {},
): Promise<AgentModel> {
  const client = createProfiledOpenAIClient(profileKey, audit)
  const params = profileChatParams(profileKey)

  return {
    async invoke(messages, opts) {
      const result = await client.chat({
        messages,
        ...(opts?.tools ? { tools: opts.tools } : {}),
        ...(opts?.signal ? { signal: opts.signal } : {}),
        ...params,
        ...(options.jsonObject && !opts?.tools ? { json: true } : {}),
      })

      if (!result.ok) {
        throw new Error(`openai ${result.status}: ${messageOf(result.errorBody)}`)
      }

      return {
        content: result.content,
        ...(result.toolCalls ? { toolCalls: result.toolCalls } : {}),
        ...(result.data?.usage ? { usage: result.data.usage } : {}),
      }
    },
  }
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

/** The text content of a model response. */
export function contentText(response: AgentModelResponse): string {
  return response.content ?? ''
}
