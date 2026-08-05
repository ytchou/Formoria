export const DEFAULT_REDACTION_MAX_BYTES = 64 * 1024;
export const REDACTED_VALUE = "[redacted]";
export const CIRCULAR_VALUE = "[circular]";

/**
 * Matched as a SUBSTRING of the normalized key. A whole-string match missed
 * every realistic variant -- `accessToken`, `refresh_token`, `api_secret_key`,
 * `sessionToken` -- and wrote them verbatim into the audit summary.
 */
const SENSITIVE_KEY_STEMS = [
  "token",
  "secret",
  "password",
  "passphrase",
  "authorization",
  "bearer",
  "cookie",
  "credential",
];

/**
 * `key` is matched as a SUFFIX, not a substring. As a substring it would
 * swallow ordinary audit fields such as `keyword` / `keywords`, which carry no
 * secret and are worth keeping in the trail.
 */
const SENSITIVE_KEY_SUFFIXES = ["key", "keys"];

/**
 * `email` stays an EXACT match. As a substring it would redact `emailBody`,
 * `emailsSent` and `emailStatus` -- the very fields the email audit rows exist
 * to record.
 */
const SENSITIVE_KEYS_EXACT = new Set(["email"]);

/**
 * Checked BEFORE every sensitive test. A measurement OF a secret is not the
 * secret: `tokenLength`, `apiKeyCount` and `tokenProvided` are exactly the
 * fields a span records to PROVE it never wrote the value itself, and the
 * `token` / `key` stems would otherwise redact them into uselessness.
 *
 * Matched as a SUFFIX so a real secret can never hide behind one -- `lengthKey`
 * and `countToken` still redact.
 */
const NON_SECRET_METRIC_SUFFIXES = [
  "length",
  "lengths",
  "count",
  "counts",
  "provided",
  "present",
];

export type RedactOptions = {
  maxBytes?: number;
};

/**
 * The shape written in place of an over-cap payload. It stays an OBJECT so the
 * `summary` jsonb column keeps object semantics and a consumer query such as
 * `summary->>'queryName'` does not silently return null against a bare string.
 */
export type TruncatedSummary = {
  truncated: true;
  bytes: number;
  preview: string;
};

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, "");
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizedKey(key);
  if (NON_SECRET_METRIC_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) return false;
  if (SENSITIVE_KEYS_EXACT.has(normalized)) return true;
  if (SENSITIVE_KEY_STEMS.some((stem) => normalized.includes(stem))) return true;
  return SENSITIVE_KEY_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

/**
 * `seen` tracks the ANCESTOR PATH, not every value ever visited: the entry is
 * removed once recursion under that value finishes. Without the removal a
 * perfectly legal shared reference -- `{ input: body, config: { source: body } }`
 * -- lost its second copy to a bogus `[circular]`.
 */
function redactedValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return CIRCULAR_VALUE;
  seen.add(value);

  try {
    if (Array.isArray(value)) {
      return value.map((entry) => redactedValue(entry, seen));
    }

    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = isSensitiveKey(key) ? REDACTED_VALUE : redactedValue(entry, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function envelopeBytes(totalBytes: number, preview: string): number {
  return byteLength(JSON.stringify({ truncated: true, bytes: totalBytes, preview }));
}

/**
 * Returns the longest whole-character prefix whose ENVELOPE still fits inside
 * `maxBytes`, or null when even an empty-preview envelope cannot fit.
 *
 * Two things this deliberately does not do: it never slices raw UTF-8 bytes (a
 * multi-byte character straddling the cut decoded to U+FFFD, and non-ASCII
 * brand names make that the common case), and it never measures the preview in
 * isolation (JSON escaping can grow it, so the cap is measured on the final
 * serialized envelope).
 */
function cappedPreview(serialized: string, totalBytes: number, maxBytes: number): string | null {
  if (envelopeBytes(totalBytes, "") > maxBytes) return null;

  // A preview can never hold more code points than the cap holds bytes, so the
  // search space stays bounded by maxBytes regardless of payload size.
  const chars = Array.from(serialized.slice(0, maxBytes + 1));

  let fits = 0;
  let upper = chars.length;
  while (fits < upper) {
    const mid = Math.ceil((fits + upper) / 2);
    if (envelopeBytes(totalBytes, chars.slice(0, mid).join("")) <= maxBytes) {
      fits = mid;
    } else {
      upper = mid - 1;
    }
  }

  return chars.slice(0, fits).join("");
}

/**
 * Honors `maxBytes` unconditionally: every branch below is measured against the
 * cap before it is returned. When the cap is smaller than the smallest possible
 * marker object there is nothing truthful left to say, so the summary degrades
 * to null rather than overshooting the cap.
 */
function capSerialized(value: unknown, maxBytes: number): unknown {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return value;

  const totalBytes = byteLength(serialized);
  if (totalBytes <= maxBytes) return value;

  const preview = cappedPreview(serialized, totalBytes, maxBytes);
  if (preview !== null) {
    const truncated: TruncatedSummary = { truncated: true, bytes: totalBytes, preview };
    return truncated;
  }

  const withoutPreview = { truncated: true, bytes: totalBytes };
  if (byteLength(JSON.stringify(withoutPreview)) <= maxBytes) return withoutPreview;

  const flagOnly = { truncated: true };
  if (byteLength(JSON.stringify(flagOnly)) <= maxBytes) return flagOnly;

  return null;
}

export function redact(value: unknown, options: RedactOptions = {}): unknown {
  const maxBytes = Math.max(0, options.maxBytes ?? DEFAULT_REDACTION_MAX_BYTES);
  return capSerialized(redactedValue(value, new WeakSet<object>()), maxBytes);
}
