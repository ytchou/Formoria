'use server'

import { runWithAuditContext } from '@/lib/audit/context'
import { isActingAsAdmin } from '@/lib/auth/admin-mode'
import { createClient } from '@/lib/supabase/server'

export type ViewerContext = {
  isAdmin: boolean
}

export async function getViewerContextAction(): Promise<ViewerContext> {
  return runWithAuditContext({}, async () => {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { isAdmin: false }
    }

    return {
      isAdmin: await isActingAsAdmin(user.email),
    }
  });
}
