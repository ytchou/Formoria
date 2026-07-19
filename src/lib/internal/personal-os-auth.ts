import { createHash, timingSafeEqual } from 'node:crypto'

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

export function isPersonalOsRequestAuthorized(request: Request): boolean {
  const expectedToken = process.env.PERSONAL_OS_INTERNAL_TOKEN
  const authorization = request.headers.get('authorization')

  if (!expectedToken || !authorization?.startsWith('Bearer ')) return false

  const suppliedToken = authorization.slice('Bearer '.length)
  return timingSafeEqual(digest(suppliedToken), digest(expectedToken))
}
