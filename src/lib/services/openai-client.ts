import { resolveOpenAIModel } from "@/lib/constants/llm-models";

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

type OpenAIChatInput = {
  system: string;
  user: string;
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
    message?: { content?: string; refusal?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: ChatUsage;
};

export type ChatUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

export type ChatAuditEvent = {
  provider: "openai";
  model: string;
  ok: boolean;
  status: number;
  data: unknown;
  usage?: ChatUsage;
  latencyMs: number;
  request: {
    system: string;
    user: string;
    imageCount: number;
  };
  meta?: Record<string, unknown>;
  error?: string;
};

export type OpenAIChatResult = {
  response: Response;
  data: OpenAIChatResponse | null;
  content: string | null;
  ok: boolean;
  status: number;
  errorBody: unknown;
  finishReason: string | null;
  refusal: string | null;
};

export function parseJson<T>(content: string): T | null {
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
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

/** Rate-limit retries per attempt. Beyond this a 429 is returned to the caller as a normal failure. */
const MAX_RATE_LIMIT_RETRIES = 5;
const MAX_NETWORK_FAILURE_RETRIES = 2;
const MAX_RATE_LIMIT_BACKOFF_MS = 30_000;

function rateLimitDelayMs(response: Response, attemptIndex: number): number {
  const retryAfter = Number(response.headers.get("retry-after"));
  const delay =
    Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 1000 * 2 ** attemptIndex;
  return Math.min(delay, MAX_RATE_LIMIT_BACKOFF_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
export function isNonRetryableProviderError(
  result: Pick<OpenAIChatResult, "errorBody">,
): boolean {
  const { errorBody } = result;
  if (!errorBody || typeof errorBody !== "object") return false;
  const { error } = errorBody as { error?: unknown };
  if (!error || typeof error !== "object") return false;
  const { code, type } = error as { code?: unknown; type?: unknown };
  return code === "insufficient_quota" || type === "insufficient_quota";
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
    async chat({
      system,
      user,
      json = false,
      timeoutMs = 30_000,
      maxTokens,
      temperature,
      reasoningEffort,
      images,
      imageDetail = "low",
      meta,
      schema,
    }: OpenAIChatInput): Promise<OpenAIChatResult> {
      // Resolved up front so a missing API key still throws instead of being swallowed as a failed attempt.
      const headers = authHeaders();
      const userContent: string | OpenAIChatContentPart[] = images?.length
        ? [
            { type: "text", text: user },
            ...images.map((image) => ({
              type: "image_url" as const,
              image_url: {
                url: typeof image === "string" ? image : image.url,
                detail: imageDetail,
              },
            })),
          ]
        : user;

      function responseFormat(useSchema: boolean): Record<string, unknown> {
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

      async function attempt(useSchema: boolean): Promise<OpenAIChatResult> {
        const startedAt = performance.now();
        // Per-attempt deadline. A shared one let a slow first call abort the retry instantly.
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const response = await fetch(OPENAI_API_URL, {
            method: "POST",
            headers,
            body: JSON.stringify({
              model,
              messages: [
                { role: "system", content: system },
                { role: "user", content: userContent },
              ],
              ...tokenBudget(),
              ...samplingAndReasoning(),
              ...responseFormat(useSchema),
            }),
            signal: controller.signal,
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
              request: { system, user, imageCount: images?.length ?? 0 },
              ...(meta ? { meta } : {}),
            });
            return {
              response,
              data: null,
              content: null,
              ok: false,
              status: response.status,
              errorBody: data,
              finishReason: null,
              refusal: null,
            };
          }

          const data = (await response.json()) as OpenAIChatResponse;
          const content = data.choices?.[0]?.message?.content?.trim() ?? null;

          await emitAudit({
            provider: "openai",
            model,
            ok: true,
            status: response.status,
            data,
            ...(data.usage ? { usage: data.usage } : {}),
            latencyMs: performance.now() - startedAt,
            request: { system, user, imageCount: images?.length ?? 0 },
            ...(meta ? { meta } : {}),
          });

          return {
            response,
            data,
            content,
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
            request: { system, user, imageCount: images?.length ?? 0 },
            ...(meta ? { meta } : {}),
            error: message,
          });
          return {
            response: networkFailureResponse(),
            data: null,
            content: null,
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
      async function attemptWithBackoff(
        useSchema: boolean,
      ): Promise<OpenAIChatResult> {
        let result = await attempt(useSchema);
        let rateLimitRetries = 0;
        let networkRetries = 0;

        while (true) {
          if (
            result.status === 0 &&
            networkRetries < MAX_NETWORK_FAILURE_RETRIES
          ) {
            const delay = rateLimitDelayMs(result.response, networkRetries);
            networkRetries += 1;
            console.error(
              `  [OPENAI] Network request failed. Retry ${networkRetries}/${MAX_NETWORK_FAILURE_RETRIES} in ${delay}ms`,
            );
            await sleep(delay);
            result = await attempt(useSchema);
            continue;
          }

          if (
            result.status === 429 &&
            rateLimitRetries < MAX_RATE_LIMIT_RETRIES
          ) {
            // Quota exhaustion wears a 429 but never clears on its own. Returning
            // it straight to the caller is what turns an outage into a fast,
            // truthful failure instead of ~31s of doomed backoff per call.
            if (isNonRetryableProviderError(result)) {
              console.error(
                "  [OPENAI] Quota exhausted (insufficient_quota) — not retrying",
              );
              return result;
            }

            const delay = rateLimitDelayMs(result.response, rateLimitRetries);
            rateLimitRetries += 1;
            console.error(
              `  [OPENAI] Rate limited (429). Retry ${rateLimitRetries}/${MAX_RATE_LIMIT_RETRIES} in ${delay}ms`,
            );
            await sleep(delay);
            result = await attempt(useSchema);
            continue;
          }

          return result;
        }
      }

      const first = await attemptWithBackoff(Boolean(schema));
      if (schema && !first.ok && mentionsResponseFormat(first.errorBody)) {
        if (!warnedStructuredOutputsUnsupported) {
          warnedStructuredOutputsUnsupported = true;
          console.warn(
            `  [OPENAI] Model ${model} rejected json_schema response_format; falling back to json_object mode.`,
          );
        }
        return await attemptWithBackoff(false);
      }
      return first;
    },
  };
}
