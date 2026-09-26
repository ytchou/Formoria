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

/** A yes/no question. The answer is a probability in `noul`. */
export type NoulQuestion = {
  type: "noul";
  instructions: string;
  criteria?: string;
};

/** Pick one option. `criteria` maps each option key to its description. */
export type ChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};

/**
 * An ordered 2–10 level scale, zero-indexed in insertion order. `criteria` maps
 * each level key to its description.
 */
export type ScoreQuestion = {
  type: "score";
  instructions: string;
  criteria: Record<string, string>;
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

export type JevUsage = {
  input_tokens: number;
  output_tokens: number;
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
  usage: JevUsage;
  latencyMs: number;
};

type TypesafeResponseBody = {
  model?: string;
  answers?: Record<string, JevAnswer>;
  usage?: Partial<JevUsage>;
};

/** A non-2xx response that survived the retry ladder. Carries the status and body. */
export class TypesafeApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(
      `TypeSafe request failed with status ${status}: ${JSON.stringify(body)}`,
    );
    this.name = "TypesafeApiError";
    this.status = status;
    this.body = body;
  }
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
          const data = (await response.json()) as TypesafeResponseBody;
          return {
            response,
            status: response.status,
            ok: true,
            data,
            errorBody: null,
            latencyMs: performance.now() - startedAt,
          };
        } catch (error) {
          // Status 0 is classified as a network failure and retried.
          return {
            status: 0,
            ok: false,
            data: null,
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
        throw new TypesafeApiError(result.status, result.errorBody);
      }

      return {
        model: result.data.model ?? model,
        answers: result.data.answers ?? {},
        usage: {
          input_tokens: result.data.usage?.input_tokens ?? 0,
          output_tokens: result.data.usage?.output_tokens ?? 0,
        },
        latencyMs: result.latencyMs,
      };
    },
  };
}
