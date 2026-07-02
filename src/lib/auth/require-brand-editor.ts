import { createClient } from '@/lib/supabase/server'
import { isActingAsAdmin } from './admin-mode'
import { getImpersonatedBrandSlug } from './impersonation'
import { isOwnerOf } from '@/lib/services/brand-owners'
import { getBrandBySlug } from '@/lib/services/brands'

export type BrandEditorContext =
  | {
      user: { id: string; email?: string | null }
      brand: Awaited<ReturnType<typeof getBrandBySlug>>
      owner: boolean
      actingAdmin: boolean
      configuredAdmin: boolean
    }
  | { error: 'notLoggedIn' | 'forbidden' | 'brandNotFound' }

async function hasMatchingImpersonation(brandSlug: string): Promise<boolean> {
  return (await getImpersonatedBrandSlug()) === brandSlug
}

export async function requireBrandEditor(brandSlug: string): Promise<BrandEditorContext> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'notLoggedIn' }
  }

  let brand
  try {
    brand = await getBrandBySlug(brandSlug)
  } catch {
    return { error: 'brandNotFound' }
  }

  const owner = await isOwnerOf(user.id, brand.id)
  const configuredAdmin = await isActingAsAdmin(user.email)
  const actingAdmin = !owner && configuredAdmin && (await hasMatchingImpersonation(brandSlug))

  if (!owner && !actingAdmin) {
    return { error: 'forbidden' }
  }

  return { user, brand, owner, actingAdmin, configuredAdmin }
}
