import { isAdmin } from './admin'

export async function isActingAsAdmin(
  email?: string | null
): Promise<boolean> {
  return !!email && isAdmin(email)
}
