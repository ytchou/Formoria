import { incrementView, incrementClick } from '@/lib/services/brand-analytics'

export const runtime = 'nodejs'

// In-memory rate limit: Map<`${ip}:${brandId}:${event}`, lastTimestamp>
// Stale entries (older than RATE_LIMIT_MS) are purged on each write to prevent unbounded growth.
const rateLimit = new Map<string, number>()
const RATE_LIMIT_MS = 30 * 60 * 1000 // 30 minutes

function purgeStaleRateLimitEntries(now: number): void {
  for (const [key, ts] of rateLimit) {
    if (now - ts >= RATE_LIMIT_MS) {
      rateLimit.delete(key)
    }
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400 })
  }

  if (!body || typeof body !== 'object') {
    return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400 })
  }

  const { brandId, event } = body as { brandId?: unknown; event?: unknown }

  if (!brandId || typeof brandId !== 'string' || brandId.trim() === '') {
    return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400 })
  }

  if (event !== 'view' && event !== 'click') {
    return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400 })
  }

  // Rate limiting
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rateLimitKey = `${ip}:${brandId}:${event}`
  const lastTime = rateLimit.get(rateLimitKey)
  const now = Date.now()
  if (lastTime && now - lastTime < RATE_LIMIT_MS) {
    return new Response(null, { status: 204 })
  }
  rateLimit.set(rateLimitKey, now)
  purgeStaleRateLimitEntries(now)

  try {
    if (event === 'view') {
      await incrementView(brandId)
    } else {
      await incrementClick(brandId)
    }
  } catch (err) {
    console.error('[analytics:track]', err)
    // silent failure — analytics are non-critical
  }

  return new Response(null, { status: 204 })
}
