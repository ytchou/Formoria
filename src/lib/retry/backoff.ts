import type { RetryPolicy } from "./policy";

function nonNegativeFinite(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function randomUnit(): number {
  const value = Math.random();
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
}

export function computeBackoffDelay(
  policy: RetryPolicy,
  attemptIndex: number,
  retryAfterMs?: number,
): number {
  const baseMs = nonNegativeFinite(policy.baseMs, 0);
  const capMs = nonNegativeFinite(policy.capMs, baseMs);
  const factor =
    Number.isFinite(policy.factor) && policy.factor > 0 ? policy.factor : 1;
  const safeAttemptIndex =
    Number.isFinite(attemptIndex) && attemptIndex >= 0
      ? Math.floor(attemptIndex)
      : 0;

  const safeRetryAfterMs = retryAfterMs;
  if (typeof safeRetryAfterMs === "number" && Number.isFinite(safeRetryAfterMs) && safeRetryAfterMs > 0) {
    return Math.max(0, Math.floor(safeRetryAfterMs + randomUnit() * baseMs));
  }

  const exponential = baseMs * factor ** safeAttemptIndex;
  const raw = Math.min(
    Number.isFinite(exponential) ? exponential : capMs,
    capMs,
  );
  const jittered = raw + randomUnit() * raw;

  return Math.max(0, Math.floor(Math.min(jittered, capMs)));
}
