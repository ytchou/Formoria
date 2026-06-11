/** Public origin for server-built redirect/callback URLs. Never derive this from request.url —
 *  behind a reverse proxy (Railway) the request host is an internal address. */
export function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}
