export const VERIFIED_BOT_HEADER = 'x-formoria-verified-bot'

// Set the first time the origin ever sees the Cloudflare-injected header. It is
// a one-way latch on purpose: it answers "does the transform rule exist yet?",
// not "did this request carry it". Two things read it -- the disagreement alarm
// (which would otherwise page on a known constant) and the enforcement
// interlock below.
let observedVerifiedHeader = false
let warnedAboutMissingHeader = false

// This header is trustworthy only because the origin is reachable exclusively
// through Cloudflare. Enforcing that origin boundary is deferred to a follow-up PR.
export function isVerifiedCrawler(request: { headers: { get(name: string): string | null } }): boolean {
  const verified = request.headers.get(VERIFIED_BOT_HEADER) === '1'
  if (verified) observedVerifiedHeader = true
  return verified
}

export function hasObservedVerifiedHeader(): boolean {
  return observedVerifiedHeader
}

export function isCrawlerVerificationShadowMode(): boolean {
  const value = process.env.VERIFIED_CRAWLER_SHADOW?.trim().toLowerCase()
  return value === undefined || !['off', '0', 'false'].includes(value)
}

/**
 * Safety interlock for the shadow-flag flip.
 *
 * With shadow off the exemption depends entirely on the Cloudflare transform
 * rule. Flipping the flag before that rule is deployed makes `verified` false
 * for every request, so Googlebot, Bingbot and Applebot (none of which carry
 * `trustedUnverified`) drop to the public bucket and start collecting 429s --
 * the exact deindexing outcome this feature exists to prevent, with no signal
 * that it happened.
 *
 * So enforcement additionally requires proof the header exists: if it has never
 * been observed, stay in shadow and log loudly. The latch clears itself the
 * moment the rule ships, which makes the interlock reversible without a code
 * change in either direction.
 */
export function isCrawlerVerificationEnforced(): boolean {
  if (isCrawlerVerificationShadowMode()) return false

  if (!observedVerifiedHeader) {
    if (!warnedAboutMissingHeader) {
      warnedAboutMissingHeader = true
      console.warn(
        `[verified-crawler] VERIFIED_CRAWLER_SHADOW is off but no ${VERIFIED_BOT_HEADER} header has ever been observed. Staying in shadow mode so search crawlers keep their rate-limit exemption. Deploy the Cloudflare transform rule before enforcing.`,
      )
    }
    return false
  }

  return true
}

export function resetVerifiedCrawlerStateForTests(): void {
  observedVerifiedHeader = false
  warnedAboutMissingHeader = false
}
