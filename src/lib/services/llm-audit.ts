import { randomUUID } from "node:crypto";
import { auditedCall, getAuditContext, type ChatAuditEvent } from "@/lib/audit";
import type { Database } from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { insertAiCallResult } from "./_shared/ai-results";
import { readResponseFormat } from "./eval/llm-usage-sink";
import type { EnrichmentTarget } from "./_shared/enrichment-target";
import {
  createOpenAIClient,
  type ChatMessage,
  type OpenAIJsonSchema,
} from "./openai-client";
import { priceUsage } from "./llm-pricing";
import { buildEnrichmentConfig } from "@/lib/constants/enrichment-config";
import type { PromptMeta } from "@/lib/langfuse/prompt";
import {
  LLM_PROFILES,
  resolveProfileModel,
  type LlmProfileKey,
  type LlmReasoningEffort,
} from "@/lib/constants/llm-models";

/** Stored system/user text is cut to this many characters, then marked. */
export const MAX_PROMPT_LENGTH = 2_000;
export const PROMPT_TRUNCATION_MARK = "…";

export type LlmAuditContext = {
  jobId?: string;
  target?: EnrichmentTarget;
  phase: string;
  attempt?: number;
  config?: unknown;
  /** Langfuse prompt metadata for linking generations to their prompt version. */
  prompt?: PromptMeta["prompt"];
  /** Injected Supabase write seam used by tests; omitted to use the service client. */
  supabase?: SupabaseClient<Database>;
};

type ClientOptions = {
  apiKey?: string;
  model?: string;
};

type ChatInput = Parameters<ReturnType<typeof createOpenAIClient>["chat"]>[0];

/** What the model answered, as the capture seam records it. */
export type CapturedResponse = {
  content: string | null;
  /** The content parsed as JSON; present only for JSON/schema calls whose content parses. */
  parsed?: unknown;
  /** The raw wire tool calls; present only when the model answered with some. */
  toolCalls?: unknown;
};

/** One model call's untruncated request and its response, handed to an offline capture seam. */
export type CapturedCall = {
  phase: string;
  /** Null when the client was not built from an LLM profile. */
  profileKey: LlmProfileKey | null;
  system: string;
  user: string;
  promptName: string | null;
  /** The full conversation as the caller sent it, untruncated. A legacy `{system,user}` call becomes two messages; its `images` are not copied. */
  messages: ChatMessage[];
  /** The strict response schema the call sent, when it sent one; an agreement replay re-sends it (DEV-1898). */
  schema?: OpenAIJsonSchema;
  response: CapturedResponse;
};

let captureSeam: ((call: CapturedCall) => void) | null = null;

/**
 * Install (or clear with `null`) a seam that observes every audited chat call
 * before truncation. Used by offline eval recording; production never sets it.
 */
export function setChatCaptureSeam(
  fn: ((call: CapturedCall) => void) | null,
): void {
  captureSeam = fn;
}

function capturedMessages(input: ChatInput): ChatMessage[] {
  if (input.messages) return input.messages;
  return [
    { role: "system", content: input.system ?? "" },
    { role: "user", content: input.user ?? "" },
  ];
}

function capturedResponse(
  input: ChatInput,
  event: ChatAuditEvent,
): CapturedResponse {
  const message = (
    event.data as {
      choices?: Array<{ message?: { content?: string | null; tool_calls?: unknown } }>;
    } | null
  )?.choices?.[0]?.message;
  // Trimmed, matching the `content` the client hands its caller.
  const content = message?.content?.trim() ?? null;
  const response: CapturedResponse = { content };
  if (content !== null && (input.json || input.schema)) {
    try {
      response.parsed = JSON.parse(content);
    } catch {
      // Unparseable JSON content stays as raw `content` only.
    }
  }
  if (message?.tool_calls !== undefined && message.tool_calls !== null) {
    response.toolCalls = message.tool_calls;
  }
  return response;
}

function capture(
  context: LlmAuditContext,
  profileKey: LlmProfileKey | null,
  input: ChatInput,
  event: ChatAuditEvent,
): void {
  if (!captureSeam) return;
  try {
    captureSeam({
      phase: context.phase,
      profileKey,
      system: event.request.system,
      user: event.request.user,
      promptName: context.prompt?.name ?? null,
      messages: capturedMessages(input),
      ...(input.schema ? { schema: input.schema } : {}),
      response: capturedResponse(input, event),
    });
  } catch {
    // Capture is an offline observer; it must never fail the call.
  }
}

function truncate(value: string): string {
  return value.length <= MAX_PROMPT_LENGTH
    ? value
    : `${value.slice(0, MAX_PROMPT_LENGTH)}${PROMPT_TRUNCATION_MARK}`;
}

/**
 * Fire-and-forget Langfuse generation for LLM calls.
 * Must never throw -- all errors are swallowed.
 */
export function emitLangfuseGeneration(
  context: LlmAuditContext,
  event: ChatAuditEvent,
  costUsd?: number | null,
): void {
  try {
    const trace = getAuditContext().langfuseTrace;
    if (trace) {
      const langfuseTrace = trace as { generation: (input: Record<string, unknown>) => void };
      const responseFormat = readResponseFormat(event.meta);
      langfuseTrace.generation({
        name: `${event.provider}/chat_completions`,
        model: event.model,
        input: { system: truncate(event.request.system), user: truncate(event.request.user) },
        output: event.data,
        usage: {
          promptTokens: event.usage?.prompt_tokens,
          completionTokens: event.usage?.completion_tokens,
        },
        ...(costUsd != null ? { costDetails: { total: costUsd } } : {}),
        ...(context.prompt
          ? {
              promptName: context.prompt.name,
              promptVersion: context.prompt.version,
            }
          : {}),
        metadata: {
          phase: context.phase,
          ok: event.ok,
          status: event.status,
          latencyMs: event.latencyMs,
          ...(responseFormat !== null ? { responseFormat } : {}),
        },
      });
    }
  } catch {
    // Langfuse errors must never block production
  }
}

async function persistAuditEvent(
  context: LlmAuditContext,
  event: ChatAuditEvent,
  spanId: string,
): Promise<void> {
  try {
    if (!context.target) return;
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
      ...(event.retryAttempt !== undefined
        ? { retryAttempt: event.retryAttempt }
        : {}),
      ...(() => {
        const configWithPrompt = {
          ...(context.config ? (context.config as object) : {}),
          ...(context.prompt ? { prompt: context.prompt } : {}),
        };
        return Object.keys(configWithPrompt).length > 0
          ? { config: configWithPrompt }
          : {};
      })(),
      latencyMs: event.latencyMs,
      auditSpanId: spanId,
      ...(context.supabase ? { supabase: context.supabase } : {}),
    });
  } catch (error) {
    console.error("[llm-audit:persist]", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function createAuditedOpenAIClient(
  context: LlmAuditContext,
  options: ClientOptions = {},
) {
  return createAuditedClient(context, options, null);
}

function createAuditedClient(
  context: LlmAuditContext,
  options: ClientOptions,
  profileKey: LlmProfileKey | null,
) {
  return {
    async chat(input: ChatInput) {
      const spanId = randomUUID();

      // The envelope wraps the whole chat call because the client retries
      // internally, so several brand_ai_results rows can share one span_id.
      // The hook remains the payload-capture seam (ADR
      // 2026-07-15-adapter-injected-llm-audit.md), not a replacement for it.
      return auditedCall(
        {
          provider: "openai",
          operation: "chat_completions",
          kind: "external",
          spanId,
          ...(context.attempt === undefined ? {} : { attempt: context.attempt }),
        },
        async (ctx) => {
          const client = createOpenAIClient({
            ...options,
            onChatComplete: async (event) => {
              capture(context, profileKey, input, event);
              ctx.model = event.model;
              let costUsd: number | null = null;
              if (event.usage) {
                // Read straight off usage, not the priced breakdown, so the
                // counts survive a price-lookup failure. Absent counts are 0.
                ctx.cachedPromptTokens =
                  event.usage.prompt_tokens_details?.cached_tokens ?? 0;
                ctx.cacheWriteTokens =
                  event.usage.prompt_tokens_details?.cache_write_tokens ?? 0;
                try {
                  const cost = await priceUsage(event.model ?? "", event.usage);
                  ctx.promptTokens = cost.promptTokens;
                  ctx.completionTokens = cost.completionTokens;
                  ctx.costUsd = cost.costUsd;
                  costUsd = cost.costUsd;
                } catch {
                  // Price lookup must never prevent the audit row from being written.
                }
              }
              await persistAuditEvent(context, event, spanId);
              emitLangfuseGeneration(context, event, costUsd);
            },
          });
          return client.chat(input);
        },
        {
          classify: (result) => (result.ok ? "succeeded" : "failed"),
          summary: { phase: context.phase, targetType: context.target?.type },
          subjectId: context.target?.id ?? null,
          jobId: context.jobId ?? null,
        },
      );
    },
  };
}

/**
 * An audited client pinned to a phase's profile model. Callers pass the profile
 * key once instead of restating a model string that can drift from the one the
 * audit row records.
 */
export function createProfiledOpenAIClient(
  profileKey: LlmProfileKey,
  context: LlmAuditContext,
  options: ClientOptions = {},
) {
  return createAuditedClient(
    context,
    { ...options, model: options.model ?? resolveProfileModel(profileKey) },
    profileKey,
  );
}

type ProfileChatParams = {
  maxTokens?: number;
  temperature: number;
  reasoningEffort?: LlmReasoningEffort;
  timeoutMs?: number;
};

/**
 * The request parameters `client.chat` takes for a phase. `model` is absent by
 * design: the chat input has no model field — the client carries it (see
 * `createProfiledOpenAIClient`).
 *
 * `extras` covers the one parameter a profile cannot know statically, image
 * classification's per-batch token budget.
 */
export function profileChatParams(
  profileKey: LlmProfileKey,
  extras: ProfileChatParams | Partial<ProfileChatParams> = {},
): ProfileChatParams {
  const profile: ProfileChatParams = LLM_PROFILES[profileKey];
  return { ...profile, ...extras };
}

/**
 * The persisted audit contract for a phase, composed from the same profile the
 * request reads. The model comes from the resolver, never a literal, so an
 * `OPENAI_MODEL_OVERRIDE` run cannot store the name of a model that never ran.
 *
 * `extraParams` carries the prompt-shaping params (`snippetLimit`,
 * `siteContentLimit`, description bands, image batch size and detail) that are
 * part of the stored contract but are not request parameters.
 */
export function buildProfiledEnrichmentConfig(
  phase: string,
  profileKey: LlmProfileKey,
  extraParams: Record<string, unknown> = {},
) {
  return buildEnrichmentConfig(phase, {
    profile: profileKey,
    ...extraParams,
  });
}
