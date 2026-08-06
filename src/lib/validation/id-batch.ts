/**
 * One shape guard for every bulk admin selection.
 *
 * The corrections, evidence, and rejection queues each carried a byte-for-byte
 * copy of this predicate that differed only in its cap and its error string, so
 * a fix to one silently left the other two behind. Callers keep owning their
 * constants and their message — those are asserted by existing tests — and share
 * only the rule.
 *
 * Deduped and order-preserving: downstream grouping stays deterministic.
 */

export type IdBatchResult =
  | { ok: true; ids: string[] }
  | { ok: false; error: string };

export type IdBatchOptions = {
  /** Maximum number of distinct ids accepted in one selection. */
  max: number;
  /** Maximum length of a single id, as a cheap payload bound. */
  maxIdLength: number;
  /** Caller-owned message returned for every rejection reason. */
  errorMessage: string;
};

export function validateIdBatch(
  ids: unknown,
  options: IdBatchOptions,
): IdBatchResult {
  if (!Array.isArray(ids)) return { ok: false, error: options.errorMessage };

  const unique = [...new Set(ids)];
  if (
    unique.length === 0 ||
    unique.length > options.max ||
    unique.some(
      (id) =>
        typeof id !== "string" ||
        id.length === 0 ||
        id.length > options.maxIdLength,
    )
  ) {
    return { ok: false, error: options.errorMessage };
  }

  return { ok: true, ids: unique as string[] };
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Shape-only check against the id column type. A malformed id sent to a
 * `.in('id', ids)` filter fails the Postgres uuid cast (22P02) and takes the
 * WHOLE batch down with it, so callers use this to demote a bad id to a
 * per-item failure before the query is built.
 */
export function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}
