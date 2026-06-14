import type { Database } from '@/lib/supabase/database.types'
import { createClient, createServiceClient } from '@/lib/supabase/server'

type ProfileRow = Database['public']['Tables']['profiles']['Row']

export type Profile = {
  displayName: string | null
  localePreference: string
  emailNotifications: boolean
}

export type ProfileUpdate = {
  displayName?: string | null
  localePreference?: string
  emailNotifications?: boolean
}

function toProfile(row: ProfileRow): Profile {
  return {
    displayName: row.display_name,
    localePreference: row.locale_preference,
    emailNotifications: row.email_notifications,
  }
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    .select('display_name, locale_preference, email_notifications')
    .eq('id', userId)
    .single()

  return data ? toProfile(data as ProfileRow) : null
}

export async function getProfileAdmin(userId: string): Promise<Profile | null> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('profiles')
    .select('display_name, locale_preference, email_notifications')
    .eq('id', userId)
    .single()

  return data ? toProfile(data as ProfileRow) : null
}

export async function updateProfile(userId: string, update: ProfileUpdate): Promise<void> {
  const supabase = await createClient()

  const row: Database['public']['Tables']['profiles']['Update'] = {}
  if (update.displayName !== undefined) row.display_name = update.displayName
  if (update.localePreference !== undefined) row.locale_preference = update.localePreference
  if (update.emailNotifications !== undefined) row.email_notifications = update.emailNotifications
  row.updated_at = new Date().toISOString()

  const { error } = await supabase.from('profiles').update(row).eq('id', userId)
  if (error) throw error
}
