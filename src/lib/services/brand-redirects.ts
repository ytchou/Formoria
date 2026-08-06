import { createServiceClient } from '@/lib/supabase/server'
import {
  hasApprovedBrandSlug as lookupApprovedBrandSlug,
  resolveApprovedBrandRedirect as lookupApprovedBrandRedirect,
} from './brand-redirects-core'

export async function hasApprovedBrandSlug(slug: string): Promise<boolean> {
  return lookupApprovedBrandSlug(slug, createServiceClient())
}

export async function resolveApprovedBrandRedirect(oldSlug: string): Promise<string | null> {
  return lookupApprovedBrandRedirect(oldSlug, createServiceClient())
}
