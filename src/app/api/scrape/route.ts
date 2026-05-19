import { NextResponse } from 'next/server'
import { scrapeUrlSchema } from '@/lib/validations/submission'
import { scrapeBrandUrl } from '@/lib/services/scraper'
import { createClient } from '@/lib/supabase/server'

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_REQUESTS = 5

const rateLimitMap = new Map<string, number[]>()
let lastSweep = Date.now()
const SWEEP_INTERVAL_MS = 5 * 60_000 // Sweep stale entries every 5 minutes

function sweepStalEntries() {
  const now = Date.now()
  if (now - lastSweep < SWEEP_INTERVAL_MS) return

  for (const [userId, timestamps] of rateLimitMap) {
    const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
    if (recent.length === 0) {
      rateLimitMap.delete(userId)
    } else {
      rateLimitMap.set(userId, recent)
    }
  }
  lastSweep = now
}

function checkRateLimit(userId: string): boolean {
  sweepStalEntries()

  const now = Date.now()
  const timestamps = rateLimitMap.get(userId) ?? []

  // Prune timestamps older than the window
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)

  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    rateLimitMap.set(userId, recent)
    return false
  }

  recent.push(now)
  rateLimitMap.set(userId, recent)
  return true
}

export async function POST(request: Request) {
  try {
    // Authenticate user
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    // Parse and validate request body
    const body = await request.json()
    const parsed = scrapeUrlSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
    }

    // Check rate limit
    if (!checkRateLimit(user.id)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Try again in 60 seconds.' },
        { status: 429 }
      )
    }

    // Scrape the URL
    const data = await scrapeBrandUrl(parsed.data.url)

    return NextResponse.json(data)
  } catch (error) {
    console.error('Scrape API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
