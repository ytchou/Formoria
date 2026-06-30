'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { isActingAsAdmin } from '@/lib/auth/admin-mode'
import {
  IMPERSONATE_COOKIE,
  IMPERSONATE_COOKIE_OPTIONS,
  signImpersonationValue,
  getImpersonatedBrandSlug,
} from '@/lib/auth/impersonation'
import { logAdminAction } from '@/lib/services/admin-audit'

export async function startImpersonationAction(
  brandSlug: string
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) return { ok: false, error: 'Not authenticated' }

  const isAdmin = await isActingAsAdmin(user.email)
  if (!isAdmin) return { ok: false, error: 'Not authorized' }

  const signed = await signImpersonationValue(brandSlug)
  ;(await cookies()).set(IMPERSONATE_COOKIE, signed, IMPERSONATE_COOKIE_OPTIONS)

  void logAdminAction({
    adminUserId: user.id,
    adminEmail: user.email,
    action: 'impersonate_start',
    targetBrandSlug: brandSlug,
  })

  revalidatePath('/dashboard')
  return { ok: true }
}

export async function endImpersonationAction(): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { ok: false, error: 'Not authenticated' }

  const brandSlug = await getImpersonatedBrandSlug()

  ;(await cookies()).delete(IMPERSONATE_COOKIE)

  if (user.email && brandSlug) {
    void logAdminAction({
      adminUserId: user.id,
      adminEmail: user.email,
      action: 'impersonate_end',
      targetBrandSlug: brandSlug,
    })
  }

  revalidatePath('/dashboard')
  return { ok: true }
}
