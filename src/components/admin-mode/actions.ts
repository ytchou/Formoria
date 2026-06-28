'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { isAdmin } from '@/lib/auth/admin'
import { signAdminModeCookieValue, ADMIN_MODE_COOKIE_OPTIONS, type AdminMode } from '@/lib/auth/admin-mode'
import { createClient } from '@/lib/supabase/server'

export async function setAdminModeAction(mode: AdminMode) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email || !isAdmin(user.email)) return { ok: false }

  const signed = await signAdminModeCookieValue(mode)
  ;(await cookies()).set('fm_mode', signed, ADMIN_MODE_COOKIE_OPTIONS)
  revalidatePath('/', 'layout')

  return { ok: true }
}
