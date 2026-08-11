import { computeBackoffDelay } from "./backoff";
import type { RetryClassification, RetryReason } from "./classify";
import type { RetryPolicy } from "./policy";

type RetryContext = {
  attemptIndex: number;
  reason: RetryReason;
  delayMs: number;
};

export type WithRetryOptions<T> = {
  classify: (result: T) => RetryClassification | Promise<RetryClassification>;
  onRetry?: (context: RetryContext) => void | Promise<void>;
  service?: string;
  sleep?: (ms: number) => Promise<void>;
};

function retryAfterMs(result: unknown): number | undefined {
  if (result instanceof Response) {
    return retryAfterFromResponse(result);
  }
  if (!result || typeof result !== "object") return undefined;
  const response = (result as { response?: unknown }).response;
  return response instanceof Response ? retryAfterFromResponse(response) : undefined;
}

function retryAfterFromResponse(response: Response): number | undefined {
  const value = Number(response.headers.get("retry-after"));
  return Number.isFinite(value) && value > 0 ? value * 1_000 : undefined;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(
  policy: RetryPolicy,
  operation: (attemptIndex: number) => T | Promise<T>,
  options: WithRetryOptions<T>,
): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  const attempts = Math.max(1, Math.floor(policy.attempts));
  let result!: T;

  for (let attemptIndex = 0; attemptIndex < attempts; attemptIndex += 1) {
    result = await operation(attemptIndex);
    const classification = await options.classify(result);
    if (!classification.retryable || attemptIndex === attempts - 1) {
      return result;
    }

    const delayMs = computeBackoffDelay(
      policy,
      attemptIndex,
      retryAfterMs(result),
    );
    const context: RetryContext = {
      attemptIndex: attemptIndex + 1,
      reason: classification.reason,
      delayMs,
    };
    console.warn(
      `[retry] service=${options.service ?? "unknown"} attempt=${context.attemptIndex} reason=${context.reason} delayMs=${context.delayMs}`,
    );
    if (options.onRetry) await options.onRetry(context);
    await sleep(delayMs);
  }

  return result;
}
