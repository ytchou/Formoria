import { withAuditScope } from '@/lib/audit/scope'
import { RATE_LIMIT_STORE_HEADER } from '@/lib/security/rate-limit-observability'
import { NextResponse } from 'next/server'

/**
 * Railway's health check reads this endpoint, so it reports on the rate-limit
 * store without ever failing on it: `status` stays `'ok'` and the HTTP status
 * stays 200 even when the limiter is degraded. A degraded limiter fails OPEN --
 * traffic is served -- and failing this probe would block the redeploy that
 * fixes the limiter, which is exactly the circular failure of 2026-08-13 that
 * this endpoint now exists to remove. `rateLimitStore` is the field an external
 * monitor reads to alarm.
 *
 * The breaker state arrives as a request header stamped by `proxy()`; the
 * middleware runs in a different isolate and its module state is not visible
 * here. Reading the plain `Request` param rather than `next/headers` keeps the
 * route testable without a request scope.
 */
export const GET = withAuditScope((request: Request) => {
  const rateLimitStore =
    request.headers.get(RATE_LIMIT_STORE_HEADER) === 'degraded' ? 'degraded' : 'ok'
  return NextResponse.json({ status: 'ok', rateLimitStore })
})
