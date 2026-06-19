import { cookies } from 'next/headers'
import { isOwnerOf } from '@/lib/services/brand-owners'
import { isAdmin } from './admin'
import { readAdminModeCookie, VIEWER_MODE_COOKIE, type AdminMode } from './admin-mode-cookie'

export {
  ADMIN_MODE_COOKIE_OPTIONS,
  readAdminModeCookie,
  resolveAdminModeCookie,
  signAdminModeCookieValue,
  VIEWER_MODE_COOKIE,
  type AdminMode,
} from './admin-mode-cookie'

export async function getAdminMode(): Promise<AdminMode> {
  const c = await cookies()
  return readAdminModeCookie(c.get(VIEWER_MODE_COOKIE)?.value) ?? 'god'
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
