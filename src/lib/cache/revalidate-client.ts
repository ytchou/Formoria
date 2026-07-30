/**
 * Out-of-Next revalidation trigger for brand mutations applied by `tsx` scripts.
 *
 * This module MUST stay Next-free: it is imported by scripts that run outside a
 * Next.js request context, where importing `@/lib/cache/public-brand-cache`
 * (and through it `next/cache`) is the first Next dependency in the process and
 * blows up the script. Bare `fetch` and `process.env` only — no `@/` imports, no
 * relative imports, no bare packages. Enforced by revalidate-client.purity.test.ts.
 */

const REVALIDATE_TIMEOUT_MS = 10_000

const REVALIDATE_PATH = '/api/internal/revalidate-brands'

type RevalidationResult = { ok: boolean; reason?: string }

function scrubError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(
      /((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s,;]+/gi,
      '$1[REDACTED]',
    )
    .slice(0, 1_000)
}

/**
 * Asks the running site to revalidate the public ISR entries touched by a brand
 * write. Never throws: the caller has already applied its mutation, so a
 * misconfigured laptop or an unreachable site must degrade to a warning.
 */
export async function requestPublicBrandRevalidation(
  slugs: string[],
): Promise<RevalidationResult> {
  const uniqueSlugs = [
    ...new Set(
      (slugs ?? [])
        .map((slug) => (typeof slug === 'string' ? slug.trim() : ''))
        .filter(Boolean),
    ),
  ]

  if (uniqueSlugs.length === 0) {
    return { ok: true, reason: 'no-slugs' }
  }

  // Prefer the Railway origin: the public host is Cloudflare-fronted and answers
  // machine POSTs with a bot challenge (HTTP 403 "Just a moment...") before the
  // request ever reaches the app, so a call to NEXT_PUBLIC_SITE_URL can never
  // succeed in production. NEXT_PUBLIC_SITE_URL stays the local-dev fallback,
  // where there is no Cloudflare in front. Same pairing the health agent uses
  // (scripts/health-agent/orchestrator.ts).
  const baseUrl = (
    process.env.FORMORIA_RAILWAY_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    ''
  ).replace(/\/+$/, '')
  const originSecret = process.env.ORIGIN_SECRET?.trim()

  if (!baseUrl || !originSecret) {
    console.warn(
      '[revalidate] skipped: FORMORIA_RAILWAY_URL (or NEXT_PUBLIC_SITE_URL) and ORIGIN_SECRET are required',
    )
    return { ok: false, reason: 'not-configured' }
  }

  try {
    const response = await fetch(`${baseUrl}${REVALIDATE_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-origin-verify': originSecret,
      },
      body: JSON.stringify({ slugs: uniqueSlugs }),
      cache: 'no-store',
      signal: AbortSignal.timeout(REVALIDATE_TIMEOUT_MS),
    })

    if (!response.ok) {
      const reason = `http-${response.status}`
      console.warn(`[revalidate] request rejected: ${reason}`)
      return { ok: false, reason }
    }

    return { ok: true }
  } catch (error) {
    const reason = scrubError(error)
    console.warn(`[revalidate] request failed: ${reason}`)
    return { ok: false, reason }
  }
}
