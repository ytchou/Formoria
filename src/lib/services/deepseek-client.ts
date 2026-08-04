import { classifyHttpResponse, IN_PROCESS, withRetry } from '@/lib/retry'
import type { ChatAuditEvent, ChatUsage } from "@/lib/audit"

export type { ChatAuditEvent, ChatUsage }

/**
 * DORMANT — retained as a fallback provider, not dead code.
 *
 * As of the gpt-5.6-luna migration no production path calls this module; every
 * text and vision call now goes through `openai-client.ts`. It stays in the
 * repo (with its test) so a provider outage or a pricing shift can be answered
 * by re-wiring call sites rather than rewriting a client from scratch.
 *
 * To revive it, re-point the five text call sites and flip their env gate back
 * from `OPENAI_API_KEY` to `DEEPSEEK_API_KEY`:
 *   - `product-type-classifier.ts` (4 sites)
 *   - `description-rewrite.ts`
 *   - `brand-facts.ts`
 *   - `reputation-research.ts`
 *
 * `DEEPSEEK_API_KEY` is still provisioned in Railway for exactly this reason —
 * it is an escape hatch, not a live dependency, so nothing health-checks it.
 */
const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_BALANCE_API_URL = "https://api.deepseek.com/user/balance";

const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";

type DeepSeekClientOptions = {
  apiKey?: string;
  model?: string;
  onChatComplete?: (event: ChatAuditEvent) => void | Promise<void>;
};

type DeepSeekImage = string | { url: string };

type DeepSeekChatInput = {
  system: string;
  user: string;
  json?: boolean;
  timeoutMs?: number;
  maxTokens?: number;
  temperature?: number;
  images?: DeepSeekImage[];
  meta?: Record<string, unknown>;
};

type DeepSeekChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type DeepSeekChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: ChatUsage;
};

export type DeepSeekChatResult = {
  response: Response;
  data: DeepSeekChatResponse | null;
  content: string | null;
  status?: number;
  errorBody?: unknown;
};

export function parseDeepSeekJson<T>(content: string): T | null {
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export function createDeepSeekClient({
  apiKey,
  model = DEFAULT_DEEPSEEK_MODEL,
  onChatComplete,
}: DeepSeekClientOptions = {}) {
  const resolvedApiKey = apiKey ?? process.env.DEEPSEEK_API_KEY;

  async function emitAudit(event: ChatAuditEvent): Promise<void> {
    if (!onChatComplete) return;

    try {
      await onChatComplete(event);
    } catch (error) {
      console.error("[deepseek-client:audit]", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function authHeaders(): Record<string, string> {
    if (!resolvedApiKey) {
      throw new Error("DEEPSEEK_API_KEY is not configured");
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
      images,
      meta,
    }: DeepSeekChatInput): Promise<DeepSeekChatResult> {
      const headers = authHeaders()
      const userContent: string | DeepSeekChatContentPart[] = images?.length
        ? [
            { type: "text", text: user },
            ...images.map((image) => ({
              type: "image_url" as const,
              image_url: { url: typeof image === "string" ? image : image.url },
            })),
          ]
        : user;

      const body = {
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent },
        ],
        ...(typeof maxTokens === "number" ? { max_tokens: maxTokens } : {}),
        ...(typeof temperature === "number" ? { temperature } : {}),
        thinking: { type: "disabled" },
        ...(json ? { response_format: { type: "json_object" } } : {}),
      };

      async function attempt(retryAttempt: number): Promise<DeepSeekChatResult> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const startedAt = performance.now();

        try {
          const response = await fetch(DEEPSEEK_API_URL, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
          });

          if (!response.ok) {
            const data = (await response
              .clone()
              .json()
              .catch(() => null)) as unknown;
            await emitAudit({
              provider: "deepseek",
              model,
              ok: false,
              status: response.status,
              data,
              latencyMs: performance.now() - startedAt,
              request: { system, user, imageCount: images?.length ?? 0 },
              retryAttempt,
              ...(meta ? { meta } : {}),
            });
            return { response, data: null, content: null, status: response.status, errorBody: data };
          }

          const data = (await response.json()) as DeepSeekChatResponse;
          const content = data.choices?.[0]?.message?.content?.trim() ?? null;

          await emitAudit({
            provider: "deepseek",
            model,
            ok: true,
            status: response.status,
            data,
            ...(data.usage ? { usage: data.usage } : {}),
            latencyMs: performance.now() - startedAt,
            request: { system, user, imageCount: images?.length ?? 0 },
            retryAttempt,
            ...(meta ? { meta } : {}),
          });

          return { response, data, content, status: response.status, errorBody: null };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await emitAudit({
            provider: "deepseek",
            model,
            ok: false,
            status: 0,
            data: null,
            latencyMs: performance.now() - startedAt,
            request: { system, user, imageCount: images?.length ?? 0 },
            retryAttempt,
            ...(meta ? { meta } : {}),
            error: message,
          });
          return {
            response: new Response(null, { status: 503, statusText: "deepseek request failed" }),
            data: null,
            content: null,
            status: 0,
            errorBody: { error: { message } },
          };
        } finally {
          clearTimeout(timeout);
        }
      }

      return withRetry(IN_PROCESS, attempt, {
        classify: classifyHttpResponse,
        service: "deepseek",
      });
    },

    async balance(timeoutMs = 3000): Promise<Response> {
      return fetch(DEEPSEEK_BALANCE_API_URL, {
        headers: authHeaders(),
        signal: AbortSignal.timeout(timeoutMs),
      });
    },
  };
}
