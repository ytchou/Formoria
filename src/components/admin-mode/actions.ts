'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { isAdmin } from '@/lib/auth/admin'
import type { AdminMode } from '@/lib/auth/admin-mode'
import { createClient } from '@/lib/supabase/server'

export async function setAdminModeAction(mode: AdminMode) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email || !isAdmin(user.email)) return { ok: false }

  ;(await cookies()).set('fm_mode', mode, {
    sameSite: 'lax',
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  })
  revalidatePath('/', 'layout')

  return { ok: true }
}
