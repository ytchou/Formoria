import { createEdgeServiceClient } from '@/lib/supabase/edge'
import { createBrandRedirectRepository } from '@/lib/adapters/brand-redirects-repository'

export function hasApprovedBrandSlug(slug: string): Promise<boolean> {
  return createBrandRedirectRepository(createEdgeServiceClient()).hasApprovedBrandSlug(slug)
}

export function resolveApprovedBrandRedirect(oldSlug: string): Promise<string | null> {
  return createBrandRedirectRepository(createEdgeServiceClient()).resolveApprovedBrandRedirect(oldSlug)
}
