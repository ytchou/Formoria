import { auditedCall } from '@/lib/audit'
import type { Database } from '@/lib/supabase/database.types'
import { createServiceClient } from '@/lib/supabase/service'

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
  const supabase = createServiceClient()
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

export async function updateProfile(userId: string, update: ProfileUpdate): Promise<void> {
  return auditedCall(
    { provider: 'brands', operation: 'updateProfile', kind: 'service' },
    async () => {
      const supabase = createServiceClient()

      const row: Database['public']['Tables']['profiles']['Update'] = {}
      if (update.displayName !== undefined) row.display_name = update.displayName
      if (update.localePreference !== undefined) row.locale_preference = update.localePreference
      row.updated_at = new Date().toISOString()

      const { error } = await supabase.from('profiles').update(row).eq('id', userId)
      if (error) throw error
    },
    { summary: { userId } },
  )
}

export async function updateProfileAdmin(userId: string, update: ProfileUpdate): Promise<void> {
  return auditedCall(
    { provider: 'brands', operation: 'updateProfileAdmin', kind: 'service' },
    async () => {
      const supabase = createServiceClient()

      const row: Database['public']['Tables']['profiles']['Update'] = {}
      if (update.displayName !== undefined) row.display_name = update.displayName
      if (update.localePreference !== undefined) row.locale_preference = update.localePreference
      row.updated_at = new Date().toISOString()

      const { error } = await supabase.from('profiles').update(row).eq('id', userId)
      if (error) throw error
    },
    { summary: { userId } },
  )
}
