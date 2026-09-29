import { JEV_MODEL } from "@/lib/constants/llm-models";
import { classifyHttpResponse, IN_PROCESS, withRetry } from "@/lib/retry";

/**
 * Raw HTTP adapter for TypeSafe AI's Jev decision model (DEV-1824).
 *
 * Jev is not OpenAI-compatible: it takes a `state` plus a map of typed questions
 * and returns one answer per question key. This module owns only the wire call.
 * The audit envelope, pricing and Langfuse generation live in `typesafe-audit.ts`.
 * Eval-only: no production call site imports this.
 */

const TYPESAFE_API_URL = "https://api.typesafe.ai/v1/systemone";
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * A yes/no question. The answer is a probability in `noul`. `criteria`, when
 * set, describes what a yes and a no mean; omit it unless the boundary is subtle.
 */
export type NoulQuestion = {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
};

/** Pick one option. `criteria` maps each option key to its description. */
export type ChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};

/**
 * An ordered 2–10 level scale, low to high. `criteria` lists the level
 * descriptions; a level's number is its array index, starting at 0.
 */
export type ScoreQuestion = {
  type: "score";
  instructions: string;
  criteria: string[];
};

export type JevQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

/** One answer. Which fields are set depends on the question type. */
export type JevAnswer = {
  noul?: number;
  choice?: string;
  probabilities?: Record<string, number>;
  score?: number;
  legend?: Record<string, string>;
  confidence?: number;
};

/** Token usage, camelCased from the snake_case wire shape at this boundary. */
export type JevUsage = {
  inputTokens: number;
  outputTokens: number;
};

/** `state` may be a string, an object or an array. */
export type JevState = string | Record<string, unknown> | unknown[];

export type JevDecideInput = {
  state: JevState;
  questions: Record<string, JevQuestion>;
  /** Defaults to the pinned `JEV_MODEL`. */
  model?: string;
};

export type JevDecideResult = {
  model: string;
  answers: Record<string, JevAnswer>;
  /** Null when the response carried no usage: token counts, and so cost, are unknown. */
  usage: JevUsage | null;
  latencyMs: number;
};

type TypesafeResponseBody = {
  model?: string;
  answers?: Record<string, JevAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

/** Why a request never got an HTTP response. Read by `classifyHttpResponse`. */
type CallStatus = "timeout" | "network_error";

/**
 * A request that failed after the retry ladder: a non-2xx status, a 2xx whose
 * body was not JSON, or (status 0) a timeout or network failure.
 */
export class TypesafeApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly callStatus: CallStatus | undefined;

  constructor(status: number, body: unknown, callStatus?: CallStatus) {
    super(
      `TypeSafe request failed with status ${status}${
        callStatus ? ` (${callStatus})` : ""
      }: ${JSON.stringify(body)}`,
    );
    // `classifyThrownError` reads a timeout from the name "AbortError", so the
    // audit envelope records it as `timeout`, not `failed`. A network failure
    // stays `failed`: that classifier recognises only a raw TypeError.
    this.name = callStatus === "timeout" ? "AbortError" : "TypesafeApiError";
    this.status = status;
    this.body = body;
    this.callStatus = callStatus;
  }
}

function isTimeoutError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

function toUsage(wire: TypesafeResponseBody["usage"]): JevUsage | null {
  if (
    typeof wire?.input_tokens !== "number" ||
    typeof wire.output_tokens !== "number"
  ) {
    return null;
  }
  return { inputTokens: wire.input_tokens, outputTokens: wire.output_tokens };
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

type TypesafeClientOptions = {
  apiKey?: string;
  fetch?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
};

type AttemptResult = {
  response?: Response;
  status: number;
  ok: boolean;
  data: TypesafeResponseBody | null;
  errorBody: unknown;
  latencyMs: number;
  callStatus?: CallStatus;
};

export function createTypesafeClient({
  apiKey,
  fetch: fetchFn = (url, init) => fetch(url, init),
  sleep,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: TypesafeClientOptions = {}) {
  const resolvedApiKey = apiKey ?? process.env.TYPESAFE_API_KEY;

  function authHeaders(): Record<string, string> {
    if (!resolvedApiKey) {
      throw new Error("TYPESAFE_API_KEY is not configured");
    }
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resolvedApiKey}`,
    };
  }

  return {
    async decide({
      state,
      questions,
      model = JEV_MODEL,
    }: JevDecideInput): Promise<JevDecideResult> {
      // Resolved up front so a missing key throws before any fetch, not as a failed attempt.
      const headers = authHeaders();
      const body = JSON.stringify({ model, state, questions });

      async function attempt(): Promise<AttemptResult> {
        const startedAt = performance.now();
        try {
          // Per-attempt deadline, so a slow first call cannot abort the retry.
          const response = await fetchFn(TYPESAFE_API_URL, {
            method: "POST",
            headers,
            body,
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (!response.ok) {
            const errorBody = (await response
              .clone()
              .json()
              .catch(() => null)) as unknown;
            return {
              response,
              status: response.status,
              ok: false,
              data: null,
              errorBody,
              latencyMs: performance.now() - startedAt,
            };
          }
          let data: TypesafeResponseBody;
          try {
            data = (await response.json()) as TypesafeResponseBody;
          } catch (error) {
            // A body-read timeout or network drop falls through to the retry path below.
            if (!(error instanceof SyntaxError)) throw error;
            // A 2xx with a malformed body is terminal: `classifyHttpResponse`
            // never retries a 2xx status, so a billed call is not resent.
            return {
              response,
              status: response.status,
              ok: false,
              data: null,
              errorBody: {
                error: { message: `invalid JSON body: ${error.message}` },
              },
              latencyMs: performance.now() - startedAt,
            };
          }
          return {
            response,
            status: response.status,
            ok: true,
            data,
            errorBody: null,
            latencyMs: performance.now() - startedAt,
          };
        } catch (error) {
          // No response: retried as a timeout or a network failure.
          return {
            status: 0,
            ok: false,
            data: null,
            callStatus: isTimeoutError(error) ? "timeout" : "network_error",
            errorBody: {
              error: {
                message: error instanceof Error ? error.message : String(error),
              },
            },
            latencyMs: performance.now() - startedAt,
          };
        }
      }

      // 429, 5xx (incl. 529) and network errors retry; 401 and 422 are terminal.
      const result = await withRetry(IN_PROCESS, attempt, {
        classify: classifyHttpResponse,
        service: "typesafe",
        ...(sleep ? { sleep } : {}),
      });

      if (!result.ok || !result.data) {
        throw new TypesafeApiError(
          result.status,
          result.errorBody,
          result.callStatus,
        );
      }

      return {
        model: result.data.model ?? model,
        answers: result.data.answers ?? {},
        usage: toUsage(result.data.usage),
        latencyMs: result.latencyMs,
      };
    },
  };
}
