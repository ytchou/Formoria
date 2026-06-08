import { isAdmin } from './admin'

export const VIEWER_MODE_COOKIE = 'fm_mode'

export type AdminMode = 'god' | 'viewer'

export function resolveAdminModeCookie({
  email,
  currentCookie,
}: {
  email: string | null
  currentCookie: string | undefined
}): { action: 'set'; value: AdminMode } | { action: 'none' } | { action: 'delete' } {
  if (email && isAdmin(email)) {
    return currentCookie ? { action: 'none' } : { action: 'set', value: 'god' }
  }

  return currentCookie ? { action: 'delete' } : { action: 'none' }
}
