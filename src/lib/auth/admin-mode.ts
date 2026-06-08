import { cookies } from 'next/headers'
import { isOwnerOf } from '@/lib/services/brand-owners'
import { isAdmin } from './admin'

export const VIEWER_MODE_COOKIE = 'fm_mode'

export type AdminMode = 'god' | 'viewer'

export async function getAdminMode(): Promise<AdminMode> {
  const c = await cookies()
  return c.get(VIEWER_MODE_COOKIE)?.value === 'viewer' ? 'viewer' : 'god'
}

export async function isViewerMode(): Promise<boolean> {
  return (await getAdminMode()) === 'viewer'
}

export async function isActingAsAdmin(
  email?: string | null
): Promise<boolean> {
  return !!email && isAdmin(email) && !(await isViewerMode())
}

export async function canManageBrand(
  userId: string,
  email: string | null | undefined,
  brandId: string
): Promise<boolean> {
  return (await isOwnerOf(userId, brandId)) || (await isActingAsAdmin(email))
}

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
