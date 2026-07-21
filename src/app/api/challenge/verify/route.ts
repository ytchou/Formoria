import { NextRequest, NextResponse } from 'next/server'
import { isRelativeUrl } from '@/lib/auth/validations'
import { signChallengeToken, CHALLENGE_COOKIE_NAME } from '@/lib/security/challenge'
import { getClientIp, rateLimit } from '@/lib/security/rate-limiter'
import { verifyTurnstileToken } from '@/lib/security/turnstile'
import { getPostHogClient } from '@/lib/posthog-server'

type ChallengeVerifyBody = {
  token?: unknown
  returnTo?: unknown
}

function getSafeRedirectPath(returnTo: unknown): string {
  return typeof returnTo === 'string' && isRelativeUrl(returnTo) ? returnTo : '/'
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request)
  const limit = await rateLimit(ip, {
    windowMs: 60_000,
    maxRequests: 10,
    prefix: 'challenge:verify',
  })

  if (!limit.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const body = (await request.json().catch(() => ({}))) as ChallengeVerifyBody

  if (typeof body.token !== 'string' || body.token.length === 0) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  }

  const turnstileResult = await verifyTurnstileToken(
    body.token,
    ip,
    request.nextUrl.host,
  )

  if (!turnstileResult.success) {
    return NextResponse.json({ error: 'Verification failed' }, { status: 400 })
  }

  const redirectTo = getSafeRedirectPath(body.returnTo)
  const challengeToken = await signChallengeToken(ip)
  const response = NextResponse.json({ redirectTo })

  response.cookies.set(CHALLENGE_COOKIE_NAME, challengeToken, {
    httpOnly: true,
    maxAge: 3600,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  })

  const posthog = getPostHogClient()
  posthog.capture({
    distinctId: request.headers.get('x-posthog-distinct-id') ?? crypto.randomUUID(),
    event: 'challenge_verified',
    properties: {
      has_custom_return_path: redirectTo !== '/',
    },
  })
  await posthog.flush()

  return response
}
