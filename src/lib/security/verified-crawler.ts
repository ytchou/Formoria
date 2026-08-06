export const VERIFIED_BOT_HEADER = 'x-formoria-verified-bot'

// This header is trustworthy only because the origin is reachable exclusively
// through Cloudflare. Enforcing that origin boundary is deferred to a follow-up PR.
export function isVerifiedCrawler(request: { headers: { get(name: string): string | null } }): boolean {
  return request.headers.get(VERIFIED_BOT_HEADER) === '1'
}

export function isCrawlerVerificationShadowMode(): boolean {
  const value = process.env.VERIFIED_CRAWLER_SHADOW?.trim().toLowerCase()
  return value === undefined || !['off', '0', 'false'].includes(value)
}
