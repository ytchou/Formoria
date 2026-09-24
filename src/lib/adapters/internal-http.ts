/**
 * Shared helpers for machine-to-machine HTTP clients that call Formoria's
 * internal endpoints. Pure: no imports, safe to load from any runtime.
 */

/** Reduces an error to a bounded message with bearer tokens and secrets redacted. */
export function scrubError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(
      /((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s,;]+/gi,
      "$1[REDACTED]",
    )
    .slice(0, 1_000);
}

/**
 * Trims a base URL, strips trailing slashes, and defaults a missing scheme to
 * https. Railway shows origins without a scheme, so env vars often arrive as a
 * bare host, which the Fetch API rejects as a relative URL. Returns "" for empty input.
 */
export function normalizeBaseUrl(raw: string | undefined): string {
  const rawBaseUrl = (raw?.trim() ?? "").replace(/\/+$/, "");
  return rawBaseUrl && !/^https?:\/\//i.test(rawBaseUrl)
    ? `https://${rawBaseUrl}`
    : rawBaseUrl;
}
