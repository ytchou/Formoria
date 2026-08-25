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

/**
 * Mirrors MAX_SLUGS in app/api/internal/revalidate-brands/route.ts.
 * Anything over the cap came back as http-400 "Too many slugs" and the write
 * landed with the public pages left stale — the failure only appears on the
 * large runs where revalidation matters most. Chunk here rather than in each
 * caller so no future caller has to remember.
 */
const MAX_SLUGS_PER_REQUEST = 200

function chunkSlugs(slugs: string[]): string[][] {
  const chunks: string[][] = []
  for (let index = 0; index < slugs.length; index += MAX_SLUGS_PER_REQUEST) {
    chunks.push(slugs.slice(index, index + MAX_SLUGS_PER_REQUEST))
  }
  return chunks
}

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

function normalizeSlugs(slugs: string[]): string[] {
  return [
    ...new Set(
      (slugs ?? [])
        .map((slug) => (typeof slug === 'string' ? slug.trim() : ''))
        .filter(Boolean),
    ),
  ]
}

/**
 * Posts one revalidation payload to the internal endpoint. Never throws: every
 * caller has already applied its mutation, so a misconfigured laptop or an
 * unreachable site must degrade to a warning.
 */
async function postRevalidation(
  body: Record<string, string[]>,
): Promise<RevalidationResult> {
  // Prefer the Railway origin: the public host is Cloudflare-fronted and answers
  // machine POSTs with a bot challenge (HTTP 403 "Just a moment...") before the
  // request ever reaches the app, so a call to NEXT_PUBLIC_SITE_URL can never
  // succeed in production. NEXT_PUBLIC_SITE_URL stays the local-dev fallback,
  // where there is no Cloudflare in front. Same pairing the health agent uses
  // (scripts/health-agent/orchestrator.ts).
  // Railway shows the origin without a scheme in its dashboard, so the env var
  // routinely lands here as a bare host. fetch() rejects that as a relative URL,
  // which surfaces as "Failed to parse URL" long after the write already landed.
  // Default a missing scheme to https rather than failing the revalidation.
  const rawBaseUrl = (
    process.env.FORMORIA_RAILWAY_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    ''
  ).replace(/\/+$/, '')
  const baseUrl = rawBaseUrl && !/^https?:\/\//i.test(rawBaseUrl)
    ? `https://${rawBaseUrl}`
    : rawBaseUrl
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
      body: JSON.stringify(body),
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

/**
 * Asks the running site to revalidate the public ISR entries touched by a brand
 * write. Never throws — see postRevalidation.
 */
export async function requestPublicBrandRevalidation(
  slugs: string[],
): Promise<RevalidationResult> {
  const uniqueSlugs = normalizeSlugs(slugs)

  if (uniqueSlugs.length === 0) {
    return { ok: true, reason: 'no-slugs' }
  }

  return postChunked(uniqueSlugs, (chunk) => ({ slugs: chunk }))
}

/**
 * Posts one request per chunk and reports the first failure. Later chunks are
 * still attempted: a partial revalidation beats abandoning the rest, since every
 * caller has already committed its write.
 */
async function postChunked(
  slugs: string[],
  toBody: (chunk: string[]) => Record<string, string[]>,
): Promise<RevalidationResult> {
  let firstFailure: RevalidationResult | null = null

  for (const chunk of chunkSlugs(slugs)) {
    const result = await postRevalidation(toBody(chunk))
    if (!result.ok && !firstFailure) firstFailure = result
  }

  return firstFailure ?? { ok: true }
}

