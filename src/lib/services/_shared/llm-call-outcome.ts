/**
 * Call-outcome accounting for the LLM helpers.
 *
 * On 2026-08-02 the OpenAI account ran out of credit mid-run. Every call came
 * back HTTP 429 `insufficient_quota`, every helper swallowed it and returned
 * `null`, and every phase reported `succeeded` anyway — 407 targets were
 * recorded green and 103 of them were approved by an admin. The information
 * needed to tell "the provider is down" apart from "the provider answered and
 * had nothing to say" was always present on `OpenAIChatResult.ok`; it was just
 * discarded at the helper boundary.
 *
 * Counts, not a boolean, on purpose. `rewriteBrandDescription` issues up to two
 * calls per brand, so a healthy-but-invalid attempt 1 followed by a
 * quota-failed attempt 2 is NOT a provider outage and must not fail the target.
 * A phase is a provider failure only when EVERY call it attempted died at the
 * provider.
 */
export type LlmCallCounts = {
  /** Calls actually issued to the provider. Zero means the helper bailed pre-flight. */
  attempted: number;
  /** Subset of `attempted` that failed at the provider (non-2xx or transport error). */
  providerFailed: number;
};

export type LlmCallOutcome<T> = {
  value: T | null;
  calls: LlmCallCounts;
};

/** No call was issued at all (no API key) — neither success nor provider fault. */
export function notAttempted<T>(): LlmCallOutcome<T> {
  return { value: null, calls: noLlmCalls() };
}

/** The call never reached the model: non-2xx. The only thing Gate C acts on. */
export function providerFailed<T>(): LlmCallOutcome<T> {
  return { value: null, calls: { attempted: 1, providerFailed: 1 } };
}

/** The provider answered; the payload was empty, unparseable or invalid. */
export function contentFailed<T>(): LlmCallOutcome<T> {
  return { value: null, calls: { attempted: 1, providerFailed: 0 } };
}

export function noLlmCalls(): LlmCallCounts {
  return { attempted: 0, providerFailed: 0 };
}

/**
 * True only when calls were made and all of them died at the provider. An
 * empty result from a healthy provider is a legitimate "nothing found" and must
 * keep its current `succeeded`/`skipped` status — that regression is the whole
 * reason this is a ratio rather than a flag.
 */
export function isLlmProviderFailure(calls: LlmCallCounts): boolean {
  return calls.attempted > 0 && calls.providerFailed === calls.attempted;
}

export function addLlmCalls(a: LlmCallCounts, b: LlmCallCounts): LlmCallCounts {
  return {
    attempted: a.attempted + b.attempted,
    providerFailed: a.providerFailed + b.providerFailed,
  };
}
