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
  type AttemptLifecycle,
} from "./openai-client";
import { priceUsage, costFromUsage, type PriceRow } from "./llm-pricing";
import { buildEnrichmentConfig } from "@/lib/constants/enrichment-config";
import type { PromptMeta } from "@/lib/langfuse/prompt";
import {
  LLM_PROFILES,
  resolveProfileModel,
  type LlmProfileKey,
  type LlmReasoningEffort,
} from "@/lib/constants/llm-models";

/**
 * Rows written before 2026-10-01 stored system/user cut to this many
 * characters, then marked. New rows store them uncut; these stay exported for
 * readers of historical rows. Langfuse still uses the cut for an over-cap input.
 */
export const MAX_PROMPT_LENGTH = 2_000;
export const PROMPT_TRUNCATION_MARK = "…";

/**
 * A Langfuse generation input above this many serialised UTF-8 bytes is cut
 * back to `{system,user}`. The SDK limit is 1,000,000 UTF-8 bytes on the whole
 * event body (input + output + metadata), and above it the SDK silently swaps
 * the input for a placeholder before our visible cut could run. The owner's
 * 1 MB decision minus headroom for output and metadata.
 */
const LANGFUSE_INPUT_MAX_BYTES = 900_000;

export type LlmAuditContext = {
  attemptLifecycle?: AttemptLifecycle;
  recordedPrice?: PriceRow;
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
type CapturedResponse = {
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
  response: CapturedResponse;
  /** The learned parameter overrides that changed this attempt (`openai-client.ts`); absent when none did. */
  paramFallback?: string[];
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
  // Copied: the caller may keep pushing turns onto its array after this call.
  if (input.messages) return [...input.messages];
  return [
    { role: "system", content: input.system ?? "" },
    { role: "user", content: input.user ?? "" },
  ];
}

/** Stands in for a `data:` image, which is never stored. */
const OMITTED_DATA_URI = { omitted: "data-uri" } as const;

/**
 * The full logical request as the caller sent it, for replay. `v` versions the
 * shape. Images are rewritten so a data URI is never stored.
 */
export type LoggedRequest = { v: 1 } & Record<string, unknown>;

// Denylist by construction: every ChatInput key must be listed (the
// `satisfies` fails typecheck on a new field), and only `signal` is dropped.
// A field missing here would make replay send a different request.
const LOGGED_INPUT_KEYS = {
  system: true,
  user: true,
  messages: true,
  tools: true,
  signal: false,
  json: true,
  timeoutMs: true,
  maxTokens: true,
  temperature: true,
  reasoningEffort: true,
  images: true,
  imageDetail: true,
  meta: true,
  schema: true,
} satisfies Record<keyof ChatInput, boolean>;

function isDataUri(url: unknown): boolean {
  return typeof url === "string" && url.startsWith("data:");
}

/**
 * Legacy `images[i]` that are data URIs become `meta.imageUrls[i]` when the two
 * lengths match and that entry is an http(s) URL; otherwise the data URI
 * becomes a placeholder, since a shifted URL would replay the wrong image and
 * an empty string or storage path cannot be fetched at all.
 */
function sanitizeImages(images: unknown, meta: unknown): unknown {
  if (!Array.isArray(images)) return images;
  const imageUrls = (meta as { imageUrls?: unknown } | undefined)?.imageUrls;
  const urls =
    Array.isArray(imageUrls) && imageUrls.length === images.length
      ? imageUrls
      : null;
  return images.map((image: unknown, index) => {
    const url =
      typeof image === "string" ? image : (image as { url?: unknown })?.url;
    if (!isDataUri(url)) return image;
    const replacement = urls?.[index];
    return typeof replacement === "string" && /^https?:\/\//i.test(replacement)
      ? replacement
      : OMITTED_DATA_URI;
  });
}

function sanitizeMessages(messages: ChatMessage[]): unknown[] {
  return messages.map((message) => {
    if (!Array.isArray(message.content)) return message;
    return {
      ...message,
      content: message.content.map((part) =>
        part.type === "image_url" && isDataUri(part.image_url.url)
          ? OMITTED_DATA_URI
          : part,
      ),
    };
  });
}

/**
 * Postgres jsonb cannot store U+0000 (22P05), and one NUL anywhere would drop
 * the whole audit and cost row. Removing an unstorable character is not
 * truncation: everything else is kept. Unchanged values keep their identity.
 */
function stripNul(value: unknown): unknown {
  if (typeof value === "string") {
    return value.includes("\u0000") ? value.replaceAll("\u0000", "") : value;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item: unknown) => {
      const stripped = stripNul(item);
      if (stripped !== item) changed = true;
      return stripped;
    });
    return changed ? next : value;
  }
  if (value !== null && typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const strippedKey = stripNul(key) as string;
      const stripped = stripNul(item);
      if (strippedKey !== key || stripped !== item) changed = true;
      next[strippedKey] = stripped;
    }
    return changed ? next : value;
  }
  return value;
}

function buildLoggedRequest(input: ChatInput): LoggedRequest {
  const request: LoggedRequest = { v: 1 };
  for (const [key, logged] of Object.entries(LOGGED_INPUT_KEYS)) {
    if (!logged) continue;
    // Read once: the value is copied as passed, so a getter runs a single time.
    const value = input[key as keyof ChatInput];
    if (value !== undefined) request[key] = value;
  }
  // Snapshotted: agent loops keep pushing turns onto the caller's array.
  if (input.messages) {
    request.messages = sanitizeMessages(capturedMessages(input));
  }
  if (request.images !== undefined) {
    request.images = sanitizeImages(request.images, request.meta);
  }
  return stripNul(request) as LoggedRequest;
}

/** Request logging must never fail the call it records. */
function safeBuildLoggedRequest(input: ChatInput): LoggedRequest | null {
  try {
    return buildLoggedRequest(input);
  } catch (error) {
    console.error("[llm-audit:request]", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function capturedResponse(
  input: ChatInput,
  event: ChatAuditEvent,
): CapturedResponse {
  const message = (
    event.data as {
      choices?: Array<{
        message?: { content?: string | null; tool_calls?: unknown };
      }>;
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
    const paramFallback = event.meta?.paramFallback;
    captureSeam({
      phase: context.phase,
      profileKey,
      system: event.request.system,
      user: event.request.user,
      promptName: context.prompt?.name ?? null,
      messages: capturedMessages(input),
      response: capturedResponse(input, event),
      ...(Array.isArray(paramFallback) && paramFallback.length > 0
        ? { paramFallback: paramFallback.map(String) }
        : {}),
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

type GenerationInput = {
  input: unknown;
  /** Present only when the full request was over the cap and was cut. */
  truncation: { inputTruncated: true; inputBytes: number } | null;
};

/**
 * The full request when it fits; above the cap, the old cut `{system,user}`
 * with a flag so the trace says it is partial. Without a request (direct
 * callers), the uncut `{system,user}`.
 */
function generationInput(
  event: ChatAuditEvent,
  request: LoggedRequest | null | undefined,
): GenerationInput {
  if (!request) {
    return {
      input: { system: event.request.system, user: event.request.user },
      truncation: null,
    };
  }
  // UTF-8 bytes, not UTF-16 units: the SDK limit is in bytes, and CJK text
  // is three bytes per char.
  const inputBytes = Buffer.byteLength(JSON.stringify(request), "utf8");
  if (inputBytes <= LANGFUSE_INPUT_MAX_BYTES) {
    return { input: request, truncation: null };
  }
  return {
    input: {
      system: truncate(event.request.system),
      user: truncate(event.request.user),
    },
    truncation: { inputTruncated: true, inputBytes },
  };
}

/**
 * Fire-and-forget Langfuse generation for LLM calls.
 * Must never throw -- all errors are swallowed.
 */
export function emitLangfuseGeneration(
  context: LlmAuditContext,
  event: ChatAuditEvent,
  costUsd?: number | null,
  logged?: { request: LoggedRequest | null; spanId: string },
): void {
  try {
    const trace = getAuditContext().langfuseTrace;
    if (trace) {
      const langfuseTrace = trace as {
        generation: (input: Record<string, unknown>) => void;
      };
      const responseFormat = readResponseFormat(event.meta);
      const { input, truncation } = generationInput(event, logged?.request);
      langfuseTrace.generation({
        name: `${event.provider}/chat_completions`,
        model: event.model,
        input,
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
          ...(truncation
            ? { ...truncation, auditSpanId: logged?.spanId }
            : {}),
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
  request: LoggedRequest | null,
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
      // NUL stripped for jsonb (see stripNul): system/user are uncut now, and
      // caller `meta` flows in here too.
      input: stripNul({
        system: event.request.system,
        user: event.request.user,
        imageCount: event.request.imageCount,
        ...(event.meta ? { meta: event.meta } : {}),
      }),
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
      request,
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
      // Synchronously, before any await: the caller may mutate its input
      // (agent loops push turns) while this call is in flight. Skipped when
      // nothing consumes it: no audit row (no target) and no Langfuse trace.
      // Both are fixed for the call, so reading them here matches the
      // completion hook's view.
      const consumesRequest =
        context.target !== undefined || Boolean(getAuditContext().langfuseTrace);
      const loggedRequest = consumesRequest
        ? safeBuildLoggedRequest(input)
        : null;
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
            attemptLifecycle: context.attemptLifecycle,
            onChatComplete: async (event) => {
              capture(context, profileKey, input, event);
              ctx.model = event.model;
              let costUsd: number | null = null;
              if (event.usage) {
                // Read straight off usage, not the priced breakdown, so the
                // counts survive a price-lookup failure. Absent counts are 0.
                ctx.promptTokens = event.usage.prompt_tokens ?? 0;
                ctx.completionTokens = event.usage.completion_tokens ?? 0;
                ctx.cachedPromptTokens =
                  event.usage.prompt_tokens_details?.cached_tokens ?? 0;
                ctx.cacheWriteTokens =
                  event.usage.prompt_tokens_details?.cache_write_tokens ?? 0;
                try {
                  const cost = context.recordedPrice
                    ? costFromUsage(event.usage, context.recordedPrice)
                    : await priceUsage(event.model ?? "", event.usage);
                  ctx.costUsd = cost.costUsd;
                  costUsd = cost.costUsd;
                } catch {
                  // Price lookup must never prevent the audit row from being written.
                }
              }
              await persistAuditEvent(context, event, spanId, loggedRequest);
              emitLangfuseGeneration(context, event, costUsd, {
                request: loggedRequest,
                spanId,
              });
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
