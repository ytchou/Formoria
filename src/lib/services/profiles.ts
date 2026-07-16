import type { Database } from '@/lib/supabase/database.types'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { normalizeOwnerLocale, type OwnerLocale } from '@/lib/types'

type ProfileRow = Database['public']['Tables']['profiles']['Row']

export type Profile = {
  displayName: string | null
  localePreference: string
}

export type ProfileUpdate = {
  displayName?: string | null
  localePreference?: string
}

function toProfile(row: ProfileRow): Profile {
  return {
    displayName: row.display_name,
    localePreference: row.locale_preference,
  }
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    .select('display_name, locale_preference')
    .eq('id', userId)
    .single()

  return data ? toProfile(data as ProfileRow) : null
}

export async function getProfileAdmin(userId: string): Promise<Profile | null> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('profiles')
    .select('display_name, locale_preference')
    .eq('id', userId)
    .single()

  return data ? toProfile(data as ProfileRow) : null
}

export async function getOwnerLocale(brandId: string): Promise<OwnerLocale> {
  const supabase = createServiceClient()
  const { data: owner, error: ownerError } = await supabase
    .from('brand_owners')
    .select('user_id')
    .eq('brand_id', brandId)
    .limit(1)
    .maybeSingle()

  if (ownerError || !owner?.user_id) {
    return 'zh-TW'
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('locale_preference')
    .eq('id', owner.user_id)
    .maybeSingle()

  if (profileError) {
    return 'zh-TW'
  }

  return normalizeOwnerLocale(profile?.locale_preference)
}

export async function updateProfile(userId: string, update: ProfileUpdate): Promise<void> {
  const supabase = await createClient()

  const row: Database['public']['Tables']['profiles']['Update'] = {}
  if (update.displayName !== undefined) row.display_name = update.displayName
  if (update.localePreference !== undefined) row.locale_preference = update.localePreference
  row.updated_at = new Date().toISOString()

  const { error } = await supabase.from('profiles').update(row).eq('id', userId)
  if (error) throw error
}
