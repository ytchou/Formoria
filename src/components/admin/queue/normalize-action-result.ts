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
  | ({ ok: false; error: string; failedIds?: string[]; raw: unknown } &
      QueueActionWarning);

export function normalizeActionResult(
  raw: unknown,
  opts?: {
    getFailureId?: (failure: Record<string, unknown>) => string | undefined;
  },
): QueueActionResult {
  if (!isRecord(raw)) return { ok: true, raw };

  // Extracted BEFORE the branch split — the failures branch used to return
  // early and drop it.
  const warning = extractWarning(raw);

  if (typeof raw.error === "string" && raw.error.length > 0) {
    return { ok: false, error: raw.error, raw, ...warning };
  }

  if (Array.isArray(raw.failures) && raw.failures.length > 0) {
    const firstFailure = raw.failures.find(
      (failure): failure is Record<string, unknown> =>
        isRecord(failure) &&
        typeof failure.error === "string" &&
        failure.error.length > 0,
    );

    const failedIds = raw.failures
      .filter(isRecord)
      .map((failure) => getFailureId(failure, opts?.getFailureId))
      .filter((id): id is string => id !== undefined);

    const result: {
      ok: false;
      error: string;
      failedIds?: string[];
      raw: unknown;
      warning?: string;
      warningKey?: string;
    } = {
      ok: false,
      error:
        typeof firstFailure?.error === "string"
          ? firstFailure.error
          : "Action failed",
      raw,
      ...warning,
    };
    if (failedIds.length > 0) result.failedIds = failedIds;
    return result;
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

function getFailureId(
  failure: Record<string, unknown>,
  customGetter?: (failure: Record<string, unknown>) => string | undefined,
) {
  if (customGetter) return customGetter(failure);

  for (const key of ["submissionId", "id", "itemId"]) {
    const value = failure[key];
    if (typeof value === "string" && value.length > 0) return value;
  }

  return undefined;
}
