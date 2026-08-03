export type RetryReason =
  | "network"
  | "timeout"
  | "rate_limit"
  | "server"
  | "terminal";

export type RetryClassification = {
  retryable: boolean;
  reason: RetryReason;
};

export const TRANSIENT_DATABASE_CODES = new Set([
  "40001",
  "40P01",
  "53000",
  "53100",
  "53200",
  "53300",
  "PGRST000",
  "PGRST001",
  "PGRST002",
  "PGRST003",
]);

type ErrorBodyCarrier = { errorBody?: unknown };
type HttpResponseLike = {
  response?: Response;
  status?: number;
  errorBody?: unknown;
  callStatus?: string;
};

function errorDetails(value: unknown): { code?: unknown; type?: unknown } {
  if (!value || typeof value !== "object") return {};
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== "object") return {};
  return error as { code?: unknown; type?: unknown };
}

export function isNonRetryableProviderError(
  result: ErrorBodyCarrier,
): boolean {
  const { code, type } = errorDetails(result.errorBody);
  return code === "insufficient_quota" || type === "insufficient_quota";
}

function statusFrom(value: Response | HttpResponseLike): number | undefined {
  if (value instanceof Response) return value.status;
  if (typeof value.status === "number") return value.status;
  return value.response?.status;
}

function errorBodyFrom(value: Response | HttpResponseLike): unknown {
  if (value instanceof Response) return undefined;
  return value.errorBody;
}

async function responseBody(response: Response | undefined): Promise<unknown> {
  if (!response) return undefined;
  return response
    .clone()
    .json()
    .catch(() => undefined);
}

export async function classifyHttpResponse(
  value: Response | HttpResponseLike,
): Promise<RetryClassification> {
  const callStatus = value instanceof Response ? undefined : value.callStatus;
  if (callStatus === "timeout") {
    return { retryable: true, reason: "timeout" };
  }
  if (callStatus === "network_error") {
    return { retryable: true, reason: "network" };
  }

  const status = statusFrom(value);
  if (status === 0) return { retryable: true, reason: "network" };

  if (status === 429) {
    const body = errorBodyFrom(value) ??
      (value instanceof Response ? await responseBody(value) : undefined);
    if (isNonRetryableProviderError({ errorBody: body })) {
      return { retryable: false, reason: "terminal" };
    }
    return { retryable: true, reason: "rate_limit" };
  }
  if (typeof status === "number" && status >= 500) {
    return { retryable: true, reason: "server" };
  }
  return { retryable: false, reason: "terminal" };
}

function errorName(error: unknown): unknown {
  return error && typeof error === "object"
    ? (error as { name?: unknown }).name
    : undefined;
}

export function classifyThrownError(error: unknown): RetryClassification {
  if (errorName(error) === "AbortError") {
    return { retryable: true, reason: "timeout" };
  }
  if (error instanceof TypeError) {
    return { retryable: true, reason: "network" };
  }
  return { retryable: false, reason: "terminal" };
}

type PostgrestErrorLike = { code?: string | null; message?: string };

export function classifyPostgrestError(
  error: PostgrestErrorLike | null | undefined,
): RetryClassification {
  const code = error?.code ?? undefined;
  if (!code || code.startsWith("08") || TRANSIENT_DATABASE_CODES.has(code)) {
    return { retryable: true, reason: "network" };
  }
  return { retryable: false, reason: "terminal" };
}

type StorageResultLike = {
  error?: unknown | null;
};

function storageStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { statusCode?: unknown; status?: unknown };
  const statusCode = candidate.statusCode ?? candidate.status;
  if (typeof statusCode === "number") return statusCode;
  if (typeof statusCode === "string" && /^\d+$/.test(statusCode)) {
    return Number(statusCode);
  }
  return undefined;
}

export function classifyStorageError(
  result: StorageResultLike | unknown,
): RetryClassification {
  const error =
    result && typeof result === "object" && "error" in result
      ? (result as StorageResultLike).error
      : result;
  if (!error) return { retryable: false, reason: "terminal" };

  const status = storageStatus(error);
  if (status === 429) return { retryable: true, reason: "rate_limit" };
  if (typeof status === "number" && status >= 500) {
    return { retryable: true, reason: "server" };
  }
  if (error instanceof TypeError || errorName(error) === "AbortError") {
    return {
      retryable: true,
      reason: errorName(error) === "AbortError" ? "timeout" : "network",
    };
  }
  return { retryable: false, reason: "terminal" };
}
