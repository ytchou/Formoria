/**
 * A warning is orthogonal to success: a bulk approve can BOTH fail on some rows
 * and carry `storageCleanupWarning`, and the consumer honours both. So the
 * warning members live on the failure arm too — a type-level exclusion there
 * makes the partial-failure toast unreachable.
 *
 * `raw` is the original payload, so a caller whose action has a richer contract
 * than these four shapes has a typed-cast door instead of an
 * assignment-in-argument closure trick.
 */
type QueueActionWarning = { warning?: string; warningKey?: string };

export type QueueActionResult =
  | ({ ok: true; raw: unknown } & QueueActionWarning)
  | ({ ok: false; error: string; raw: unknown } & QueueActionWarning);

export function normalizeActionResult(raw: unknown): QueueActionResult {
  if (!isRecord(raw)) return { ok: true, raw };

  // Extracted BEFORE the branch split — the failures branch used to return
  // early and drop it.
  const warning = extractWarning(raw);

  if (typeof raw.error === "string" && raw.error.length > 0) {
    return { ok: false, error: raw.error, raw, ...warning };
  }

  // A non-empty `failures` array is a failure, full stop. No consumer routes
  // through this branch today — all three bulk callers inspect `result.failures`
  // themselves and hand `run` an already-shaped `{ error }` — but the branch is
  // a classification guard, not dead code: dropping it would make a raw
  // `{ failures: [...] }` payload normalize to `ok: true` and swallow the
  // failure silently. What WAS dead is id extraction: it assumed an
  // `{ error }`-per-failure shape that the two new bulk services do not produce
  // (theirs is `{ id, code }`), and nothing ever read the resulting `failedIds`.
  if (Array.isArray(raw.failures) && raw.failures.length > 0) {
    const firstMessage = raw.failures
      .filter(isRecord)
      .map((failure) => failure.error)
      .find(
        (message): message is string =>
          typeof message === "string" && message.length > 0,
      );

    return {
      ok: false,
      error: firstMessage ?? "Action failed",
      raw,
      ...warning,
    };
  }

  return { ok: true, raw, ...warning };
}

function extractWarning(raw: Record<string, unknown>): {
  warning?: string;
  warningKey?: string;
} {
  const result: { warning?: string; warningKey?: string } = {};

  if (typeof raw.warning === "string" && raw.warning.length > 0) {
    result.warning = raw.warning;
  }

  // Indexing the tuple keeps the positional `string` type; `.at(0)` widens a
  // [string, unknown] pair to unknown and loses it.
  const warningFlag = Object.entries(raw).find(
    ([key, value]) => key.endsWith("Warning") && value === true,
  );
  if (warningFlag) result.warningKey = warningFlag[0];

  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
