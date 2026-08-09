import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Creates a Supabase client using the service role key.
 * Bypasses RLS — use only in service layer functions for admin operations.
 * Does not need cookies since the service role key grants full access.
 *
 * This module deliberately has no Next.js-only imports so it can be loaded by
 * the curation worker and other plain Node scripts.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _serviceClient: ReturnType<typeof createSupabaseClient<any>> | null = null;

export function createServiceClient() {
  if (!_serviceClient) {
    _serviceClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _serviceClient;
}
