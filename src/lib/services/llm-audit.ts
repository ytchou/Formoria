import { randomUUID } from "node:crypto";
import { auditedCall, getAuditContext, type ChatAuditEvent } from "@/lib/audit";
import type { Database } from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { insertAiCallResult } from "./_shared/ai-results";
import type { EnrichmentTarget } from "./_shared/enrichment-target";
import { createOpenAIClient } from "./openai-client";
import { priceUsage } from "./llm-pricing";
import { buildEnrichmentConfig } from "@/lib/constants/enrichment-config";
import {
  LLM_PROFILES,
  resolveProfileModel,
  type LlmProfileKey,
  type LlmReasoningEffort,
} from "@/lib/constants/llm-models";

const MAX_PROMPT_LENGTH = 2_000;

export type LlmAuditContext = {
  jobId?: string;
  target?: EnrichmentTarget;
  phase: string;
  attempt?: number;
  config?: unknown;
  /** Injected Supabase write seam used by tests; omitted to use the service client. */
  supabase?: SupabaseClient<Database>;
};

type ClientOptions = {
  apiKey?: string;
  model?: string;
};

function truncate(value: string): string {
  return value.length <= MAX_PROMPT_LENGTH
    ? value
    : `${value.slice(0, MAX_PROMPT_LENGTH)}…`;
}

/**
 * Fire-and-forget Langfuse generation for LLM calls.
 * Must never throw -- all errors are swallowed.
 */
function emitLangfuseGeneration(
  context: LlmAuditContext,
  event: ChatAuditEvent,
): void {
  try {
    const trace = getAuditContext().langfuseTrace;
    if (trace) {
      const langfuseTrace = trace as { generation: (input: Record<string, unknown>) => void };
      langfuseTrace.generation({
        name: `${event.provider}/chat_completions`,
        model: event.model,
        input: { system: truncate(event.request.system), user: truncate(event.request.user) },
        output: event.data,
        usage: {
          promptTokens: event.usage?.prompt_tokens,
          completionTokens: event.usage?.completion_tokens,
        },
        metadata: {
          phase: context.phase,
          ok: event.ok,
          status: event.status,
          latencyMs: event.latencyMs,
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
      ...(context.config !== undefined ? { config: context.config } : {}),
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
  return {
    async chat(
      input: Parameters<ReturnType<typeof createOpenAIClient>["chat"]>[0],
    ) {
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
              if (event.usage) {
                try {
                  const cost = await priceUsage(event.model ?? "", event.usage);
                  ctx.promptTokens = cost.promptTokens;
                  ctx.completionTokens = cost.completionTokens;
                  ctx.costUsd = cost.costUsd;
                } catch {
                  // Price lookup must never prevent the audit row from being written.
                }
              }
              await persistAuditEvent(context, event, spanId);
              emitLangfuseGeneration(context, event);
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
  return createAuditedOpenAIClient(context, {
    ...options,
    model: options.model ?? resolveProfileModel(profileKey),
  });
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
  systemPrompt: string,
  profileKey: LlmProfileKey,
  extraParams: Record<string, unknown> = {},
) {
  return buildEnrichmentConfig(phase, systemPrompt, {
    model: resolveProfileModel(profileKey),
    ...profileChatParams(profileKey),
    ...extraParams,
  });
}
