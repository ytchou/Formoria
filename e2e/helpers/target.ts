/**
 * Detects whether the suite is running against the local dev server or a
 * Cloudflare-protected remote (deployed staging / preview).
 *
 * Cloudflare's WAF managed-challenge blocks raw HTTP requests that
 * impersonate crawlers (`user-agent: "Googlebot"`). Tests that rely on that
 * trick — asserting server-rendered HTML from a non-browser request — must
 * skip on a remote target because the response will be a 403 challenge page,
 * not the app.
 */
export function isLocalTarget(baseURL: string | undefined): boolean {
  if (!baseURL) return true;
  const hostname = new URL(baseURL).hostname;
  return ["localhost", "127.0.0.1", "::1"].includes(hostname);
}
