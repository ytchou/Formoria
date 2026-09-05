import { resolveOpenAIModel } from "@/lib/constants/llm-models";
import type { ChatAuditEvent, ChatUsage } from "@/lib/audit";
import {
  classifyHttpResponse,
  IN_PROCESS,
  withRetry,
} from "@/lib/retry";

export type { ChatAuditEvent, ChatUsage };

/**
 * A 429 that retrying cannot fix.
 *
 * `insufficient_quota` — a spent or unfunded account — is served with the same
 * HTTP 429 as a genuine rate limit, so the backoff loop below treated a dead
 * account as congestion: 5 retries and ~31s of sleep per call, multiplied by
 * every LLM call of a 400-brand run (2026-08-02). Rate limits recover; an empty
 * balance does not, so this breaks out on the first attempt.
 *
 * Matches on `code`/`type` rather than the message string: the message is
 * prose OpenAI is free to reword, the codes are the documented contract.
 */
export { isNonRetryableProviderError } from "@/lib/retry";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

// The model literal and the per-phase request profiles live in
// `@/lib/constants/llm-models`. Re-exported here because this module is the
// historical import site for the resolver, and every caller reading the model
// for an audit row must keep reading the same function.
export { resolveOpenAIModel };

type OpenAIClientOptions = {
  apiKey?: string;
  model?: string;
  onChatComplete?: (event: ChatAuditEvent) => void | Promise<void>;
};

type OpenAIImage = string | { url: string };

type OpenAIJsonSchema = {
  name: string;
  schema: Record<string, unknown>;
};

/** An OpenAI wire message. Agent turns send these directly; `{system,user}` is normalized into them. */
export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | OpenAIChatContentPart[] }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    }
  | { role: "tool"; content: string; tool_call_id: string };

/** A function the model may call. Wrapped into `{ type:'function', function }` on the wire. */
export type ChatToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

/**
 * A parsed tool call. `arguments` arrives as a JSON *string* the model wrote, so it
 * can be malformed: an unparsable payload keeps `args: {}` and hands the raw text to
 * the caller rather than throwing out of a graph node.
 */
export type ChatToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  rawArguments?: string;
};

type OpenAIToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type OpenAIChatInput = {
  system?: string;
  user?: string;
  /** A full conversation. Mutually exclusive with `system`+`user`. */
  messages?: ChatMessage[];
  /** Function definitions. Cannot be combined with `json`/`schema` — a forced JSON body suppresses tool calls. */
  tools?: ChatToolDefinition[];
  /** Caller cancellation, combined with the per-attempt timeout. An abort ends the call without retrying. */
  signal?: AbortSignal;
  json?: boolean;
  timeoutMs?: number;
  maxTokens?: number;
  temperature?: number;
  /**
   * Reasoning budget, for `gpt-5`-family models only. Ignored by older snapshots,
   * which have no reasoning to spend. Every phase here is extraction or closed-set
   * classification against a fixed rubric, so `none` is the intended production value.
   */
  reasoningEffort?: "none" | "low" | "medium" | "high";
  images?: OpenAIImage[];
  /** `low` caps every image at 512px; `high` tiles it. Defaults to `low` for cost. */
  imageDetail?: "low" | "high" | "auto";
  meta?: Record<string, unknown>;
  schema?: OpenAIJsonSchema;
};

type OpenAIChatContentPart =
  | { type: "text"; text: string }
  | {
      type: "image_url";
      image_url: { url: string; detail: "low" | "high" | "auto" };
    };

type OpenAIChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      refusal?: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason?: string | null;
  }>;
  usage?: ChatUsage;
};

export type OpenAIChatResult = {
  response: Response;
  data: OpenAIChatResponse | null;
  content: string | null;
  /** Non-null only when the model answered with tool calls. */
  toolCalls: ChatToolCall[] | null;
  ok: boolean;
  status: number;
  errorBody: unknown;
  finishReason: string | null;
  refusal: string | null;
};

function parseToolCalls(
  calls: OpenAIToolCall[] | undefined,
): ChatToolCall[] | null {
  if (!calls?.length) return null;
  return calls.map((call) => {
    const raw = call.function?.arguments ?? "";
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return {
          id: call.id,
          name: call.function.name,
          args: parsed as Record<string, unknown>,
        };
      }
    } catch {
      // Falls through to the raw-arguments branch below.
    }
    return {
      id: call.id,
      name: call.function?.name ?? "",
      args: {},
      rawArguments: raw,
    };
  });
}

/** First text of a role, for the audit row. Image parts are dropped; the count is carried separately. */
function firstMessageText(messages: ChatMessage[], role: string): string {
  for (const message of messages) {
    if (message.role !== role) continue;
    const { content } = message;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const text = content.find(
        (part): part is { type: "text"; text: string } => part.type === "text",
      );
      if (text) return text.text;
    }
    return "";
  }
  return "";
}

/**
 * `gpt-5`-family models differ from the chat models in two ways, both hard 400s:
 *
 *   - `max_tokens` is rejected outright — use `max_completion_tokens`.
 *   - Sampling parameters are only live when internal reasoning is OFF.
 *     `temperature: 0` alone fails with "does not support 0.0 with this model";
 *     the same call with `reasoning_effort: 'none'` succeeds. Any other effort
 *     re-enables reasoning and re-rejects the temperature.
 *
 * Probed parameter-by-parameter against `gpt-5.6-luna` on 2026-08-02:
 *
 *   temperature 0                          -> 400
 *   temperature 0 + reasoning_effort none  -> OK
 *   temperature 0 + reasoning_effort low   -> 400
 *   reasoning_effort minimal               -> 400 (unsupported value)
 *
 * An earlier note here recorded that temperature "passed through on every
 * model". It does not, and that assumption silently failed every image
 * classification the moment the default model moved to luna — the phase still
 * reported success because a failed batch is logged as skipped.
 */
function isReasoningModel(model: string): boolean {
  return model.startsWith("gpt-5");
}

// Latched so a model snapshot without Structured Outputs warns once per process, not per batch.
let warnedStructuredOutputsUnsupported = false;

function mentionsResponseFormat(errorBody: unknown): boolean {
  if (!errorBody || typeof errorBody !== "object") return false;
  const { error } = errorBody as { error?: unknown };
  if (!error || typeof error !== "object") return false;
  const { message, param } = error as { message?: unknown; param?: unknown };
  const haystack = [
    typeof message === "string" ? message : "",
    typeof param === "string" ? param : "",
  ].join(" ");
  return (
    haystack.includes("response_format") || haystack.includes("json_schema")
  );
}

function networkFailureResponse(): Response {
  return new Response(null, {
    status: 503,
    statusText: "openai request failed",
  });
}

export function createOpenAIClient({
  apiKey,
  model = resolveOpenAIModel(),
  onChatComplete,
}: OpenAIClientOptions = {}) {
  const resolvedApiKey = apiKey ?? process.env.OPENAI_API_KEY;

  async function emitAudit(event: ChatAuditEvent): Promise<void> {
    if (!onChatComplete) return;

    try {
      await onChatComplete(event);
    } catch (error) {
      console.error("[openai-client:audit]", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function authHeaders(): Record<string, string> {
    if (!resolvedApiKey) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resolvedApiKey}`,
    };
  }

  return {
    async chat(input: OpenAIChatInput): Promise<OpenAIChatResult> {
      const {
        system,
        user,
        messages,
        tools,
        json = false,
        timeoutMs = 30_000,
        maxTokens,
        temperature,
        reasoningEffort,
        images,
        imageDetail = "low",
        meta,
        schema,
      } = input;

      const hasLegacyPair = system !== undefined && user !== undefined;
      if (Boolean(messages) === hasLegacyPair) {
        throw new Error(
          "openai-client: provide exactly one of messages or system+user",
        );
      }
      if (tools && (json || schema)) {
        throw new Error(
          "openai-client: tools cannot be combined with a forced JSON response_format",
        );
      }

      // Resolved up front so a missing API key still throws instead of being swallowed as a failed attempt.
      const headers = authHeaders();
      // Images stay on the legacy branch: a caller sending `messages` builds its own parts.
      const userContent: string | OpenAIChatContentPart[] = images?.length
        ? [
            { type: "text", text: user ?? "" },
            ...images.map((image) => ({
              type: "image_url" as const,
              image_url: {
                url: typeof image === "string" ? image : image.url,
                detail: imageDetail,
              },
            })),
          ]
        : (user ?? "");

      // One wire message array for both input shapes, so `attempt()` has a single request builder.
      const wireMessages: ChatMessage[] = messages ?? [
        { role: "system", content: system ?? "" },
        { role: "user", content: userContent },
      ];

      function auditRequest(): ChatAuditEvent["request"] {
        return {
          system: firstMessageText(wireMessages, "system"),
          user: firstMessageText(wireMessages, "user"),
          imageCount: images?.length ?? 0,
        };
      }

      /**
       * Legacy `{system,user}` calls keep emitting exactly today's audit event —
       * the counts are only meaningful for a conversation the caller composed.
       */
      function auditMeta(): { meta?: Record<string, unknown> } {
        if (!messages) return meta ? { meta } : {};
        return {
          meta: {
            ...(meta ?? {}),
            messageCount: wireMessages.length,
            toolCallCount: tools?.length ?? 0,
          },
        };
      }

      function responseFormat(useSchema: boolean): Record<string, unknown> {
        // A forced JSON body and tool calling are mutually exclusive on the wire.
        if (tools) return {};
        if (useSchema && schema) {
          return {
            response_format: {
              type: "json_schema",
              json_schema: {
                name: schema.name,
                strict: true,
                schema: schema.schema,
              },
            },
          };
        }
        return json || schema
          ? { response_format: { type: "json_object" } }
          : {};
      }

      /**
       * `max_tokens` is a hard 400 on reasoning models; `temperature` is not, so it
       * passes through for every model and existing callers keep their values.
       */
      function tokenBudget(): Record<string, unknown> {
        if (typeof maxTokens !== "number") return {};
        return isReasoningModel(model)
          ? { max_completion_tokens: maxTokens }
          : { max_tokens: maxTokens };
      }

      /**
       * Temperature and reasoning effort are one decision on gpt-5 models, not
       * two: sampling is only applied when reasoning is off, so a caller asking
       * for a temperature is implicitly asking for `reasoning_effort: 'none'`.
       *
       * A caller that explicitly wants reasoning gets it, and its temperature is
       * dropped rather than sent — the two cannot both apply, and sending both
       * is a 400 that would fail the whole call.
       */
      function samplingAndReasoning(): Record<string, unknown> {
        const wantsTemperature = typeof temperature === "number";
        if (!isReasoningModel(model)) {
          return wantsTemperature ? { temperature } : {};
        }
        if (reasoningEffort && reasoningEffort !== "none") {
          return { reasoning_effort: reasoningEffort };
        }
        if (wantsTemperature) {
          return { temperature, reasoning_effort: "none" };
        }
        return reasoningEffort ? { reasoning_effort: reasoningEffort } : {};
      }

      async function attempt(
        useSchema: boolean,
        retryAttempt: number,
      ): Promise<OpenAIChatResult> {
        const startedAt = performance.now();
        // Per-attempt deadline. A shared one let a slow first call abort the retry instantly.
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const signal = input.signal
          ? AbortSignal.any([controller.signal, input.signal])
          : controller.signal;

        try {
          const response = await fetch(OPENAI_API_URL, {
            method: "POST",
            headers,
            body: JSON.stringify({
              model,
              messages: wireMessages,
              ...(tools
                ? {
                    tools: tools.map((tool) => ({
                      type: "function" as const,
                      function: {
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.parameters,
                      },
                    })),
                  }
                : {}),
              ...tokenBudget(),
              ...samplingAndReasoning(),
              ...responseFormat(useSchema),
            }),
            signal,
          });

          if (!response.ok) {
            const data = (await response
              .clone()
              .json()
              .catch(() => null)) as unknown;
            await emitAudit({
              provider: "openai",
              model,
              ok: false,
              status: response.status,
              data,
              latencyMs: performance.now() - startedAt,
              request: auditRequest(),
              retryAttempt,
              ...auditMeta(),
            });
            return {
              response,
              data: null,
              content: null,
              toolCalls: null,
              ok: false,
              status: response.status,
              errorBody: data,
              finishReason: null,
              refusal: null,
            };
          }

          const data = (await response.json()) as OpenAIChatResponse;
          const content = data.choices?.[0]?.message?.content?.trim() ?? null;
          const toolCalls = parseToolCalls(
            data.choices?.[0]?.message?.tool_calls,
          );

          await emitAudit({
            provider: "openai",
            model,
            ok: true,
            status: response.status,
            data,
            ...(data.usage ? { usage: data.usage } : {}),
            latencyMs: performance.now() - startedAt,
            request: auditRequest(),
            retryAttempt,
            ...auditMeta(),
          });

          return {
            response,
            data,
            content,
            toolCalls,
            ok: true,
            status: response.status,
            errorBody: null,
            finishReason: data.choices?.[0]?.finish_reason ?? null,
            refusal: data.choices?.[0]?.message?.refusal ?? null,
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          await emitAudit({
            provider: "openai",
            model,
            ok: false,
            status: 0,
            data: null,
            latencyMs: performance.now() - startedAt,
            request: auditRequest(),
            retryAttempt,
            ...auditMeta(),
            error: message,
          });
          return {
            response: networkFailureResponse(),
            data: null,
            content: null,
            toolCalls: null,
            ok: false,
            status: 0,
            errorBody: { error: { message } },
            finishReason: null,
            refusal: null,
          };
        } finally {
          clearTimeout(timeout);
        }
      }

      /** Provider congestion and thrown fetches are retried here for every production caller. */
      async function attemptWithRetry(
        useSchema: boolean,
      ): Promise<OpenAIChatResult> {
        return withRetry(IN_PROCESS, (retryAttempt) => attempt(useSchema, retryAttempt), {
          // A caller that cancelled is not waiting for a backoff sleep: an aborted
          // signal ends the ladder on the attempt that saw it.
          classify: (result) =>
            input.signal?.aborted
              ? { retryable: false, reason: "terminal" as const }
              : classifyHttpResponse(result),
          service: "openai",
        });
      }

      const first = await attemptWithRetry(Boolean(schema));
      if (schema && !first.ok && mentionsResponseFormat(first.errorBody)) {
        if (!warnedStructuredOutputsUnsupported) {
          warnedStructuredOutputsUnsupported = true;
          console.warn(
            `  [OPENAI] Model ${model} rejected json_schema response_format; falling back to json_object mode.`,
          );
        }
        return await attemptWithRetry(false);
      }
      return first;
    },
  };
}
