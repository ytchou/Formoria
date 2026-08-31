'use server'

import { runWithAuditContext } from '@/lib/audit/context'
import { isActingAsAdmin } from '@/lib/auth/admin-mode'
import { createClient } from '@/lib/supabase/server'

export type ViewerContext = {
  user: {
    id: string
    email: string | null
    provider: string
  } | null
  isAdmin: boolean
}

export async function getViewerContextAction(): Promise<ViewerContext> {
  return runWithAuditContext({}, async () => {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { user: null, isAdmin: false }
    }

    return {
      user: {
        id: user.id,
        email: user.email ?? null,
        provider: user.app_metadata?.provider ?? 'email',
      },
      isAdmin: await isActingAsAdmin(user.email),
    }
  });
}
