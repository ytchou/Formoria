import { isAdmin } from './admin'
import { signCookieValue, verifyCookieValue } from '../security/cookie-signing'

export const VIEWER_MODE_COOKIE = 'fm_mode'
export const ADMIN_MODE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: process.env.NODE_ENV === 'production',
  maxAge: 86400,
  path: '/',
}

export type AdminMode = 'god' | 'viewer'

function getAdminModeCookieSecret(): string | null {
  return process.env.CHALLENGE_SECRET || null
}

export async function signAdminModeCookieValue(value: AdminMode): Promise<string> {
  const secret = getAdminModeCookieSecret()
  if (!secret) {
    throw new Error('CHALLENGE_SECRET is required')
  }

  return signCookieValue(value, secret)
}

export async function readAdminModeCookie(value: string | null | undefined): Promise<AdminMode | null> {
  const secret = getAdminModeCookieSecret()
  if (!value || !secret) return null

  const verified = await verifyCookieValue(value, secret)
  return verified === 'god' || verified === 'viewer' ? verified : null
}

export async function resolveAdminModeCookie({
  email,
  currentCookie,
}: {
  email: string | null
  currentCookie: string | undefined
}): Promise<{ action: 'set'; value: string } | { action: 'none' } | { action: 'delete' }> {
  const currentMode = await readAdminModeCookie(currentCookie)

  if (email && isAdmin(email)) {
    return currentMode ? { action: 'none' } : { action: 'set', value: await signAdminModeCookieValue('god') }
  }

  return currentCookie ? { action: 'delete' } : { action: 'none' }
}
