import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

/**
 * Service-role client for the Next.js proxy runtime. The proxy is a server
 * boundary, but it cannot import `supabase/server` because that module is
 * protected by `server-only` and also depends on request cookies.
 */
export function createEdgeServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  )
}
