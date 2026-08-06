import { createEdgeServiceClient } from '@/lib/supabase/edge'
import {
  hasApprovedBrandSlug as lookupApprovedBrandSlug,
  resolveApprovedBrandRedirect as lookupApprovedBrandRedirect,
} from './brand-redirects-core'

export function hasApprovedBrandSlug(slug: string): Promise<boolean> {
  return lookupApprovedBrandSlug(slug, createEdgeServiceClient())
}

export function resolveApprovedBrandRedirect(oldSlug: string): Promise<string | null> {
  return lookupApprovedBrandRedirect(oldSlug, createEdgeServiceClient())
}
