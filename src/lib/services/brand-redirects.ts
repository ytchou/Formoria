import { createServiceClient } from '@/lib/supabase/service'
import { createBrandRedirectRepository } from '@/lib/adapters/brand-redirects-repository'

export async function resolveApprovedBrandRedirect(oldSlug: string): Promise<string | null> {
  return createBrandRedirectRepository(createServiceClient()).resolveApprovedBrandRedirect(oldSlug)
}
