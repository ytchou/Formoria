import { createServiceClient } from '@/lib/supabase/server'
import { createBrandRedirectRepository } from '@/lib/adapters/brand-redirects-repository'

export async function hasApprovedBrandSlug(slug: string): Promise<boolean> {
  return createBrandRedirectRepository(createServiceClient()).hasApprovedBrandSlug(slug)
}

export async function resolveApprovedBrandRedirect(oldSlug: string): Promise<string | null> {
  return createBrandRedirectRepository(createServiceClient()).resolveApprovedBrandRedirect(oldSlug)
}
