import { createHash, timingSafeEqual } from 'node:crypto'

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

/**
 * True when the request carries `Authorization: Bearer <token>` matching the
 * env var `envName`. An unset or blank (after trim) env value rejects every
 * request. Compares sha256 digests so the comparison is constant-time and
 * length-independent.
 */
export function isBearerAuthorized(request: Request, envName: string): boolean {
  const expectedToken = process.env[envName]?.trim()
  const authorization = request.headers.get('authorization')

  if (!expectedToken || !authorization?.startsWith('Bearer ')) return false

  const suppliedToken = authorization.slice('Bearer '.length)
  return timingSafeEqual(digest(suppliedToken), digest(expectedToken))
}

export function isPersonalOsRequestAuthorized(request: Request): boolean {
  return isBearerAuthorized(request, 'PERSONAL_OS_INTERNAL_TOKEN')
}

/** The ops routine's relay routes (`/api/internal/ops-summary`, `/api/internal/run-timeline`). */
export function isOpsRoutineAuthorized(request: Request): boolean {
  return isBearerAuthorized(request, 'OPS_ROUTINE_CALLBACK_TOKEN')
}
