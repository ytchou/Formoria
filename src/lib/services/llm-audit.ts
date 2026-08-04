import { insertAiCallResult } from "./_shared/ai-results";
import {
  createDeepSeekClient,
  type ChatAuditEvent as DeepSeekAuditEvent,
} from "./deepseek-client";
import type { EnrichmentTarget } from "./_shared/enrichment-target";
import {
  createOpenAIClient,
  type ChatAuditEvent as OpenAiAuditEvent,
} from "./openai-client";
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
  target: EnrichmentTarget;
  phase: string;
  attempt?: number;
  config?: unknown;
};

type ClientOptions = {
  apiKey?: string;
  model?: string;
};

type AuditEvent = DeepSeekAuditEvent | OpenAiAuditEvent;

function truncate(value: string): string {
  return value.length <= MAX_PROMPT_LENGTH
    ? value
    : `${value.slice(0, MAX_PROMPT_LENGTH)}…`;
}

async function persistAuditEvent(
  context: LlmAuditContext,
  event: AuditEvent,
): Promise<void> {
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
      ...(event.retryAttempt !== undefined
        ? { retryAttempt: event.retryAttempt }
        : {}),
      ...(context.config !== undefined ? { config: context.config } : {}),
      latencyMs: event.latencyMs,
    });
  } catch (error) {
    console.error("[llm-audit:persist]", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function createAuditedDeepSeekClient(
  context: LlmAuditContext,
  options: ClientOptions = {},
) {
  return createDeepSeekClient({
    ...options,
    onChatComplete: (event) => persistAuditEvent(context, event),
  });
}

export function createAuditedOpenAIClient(
  context: LlmAuditContext,
  options: ClientOptions = {},
) {
  return createOpenAIClient({
    ...options,
    onChatComplete: (event) => persistAuditEvent(context, event),
  });
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
