import { createClient } from '@supabase/supabase-js'
import type { Json } from '@/lib/supabase/database.types'
import { createServiceClient } from '@/lib/supabase/server'

export const SUBCATEGORY_FILTER_KEY = 'subcategory_filter_enabled'

export async function getAppSetting<T extends Json = Json>(
  key: string,
  defaultValue?: T
): Promise<T | undefined> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle()

  if (error || !data) {
    console.error(
      'getAppSetting app_settings query error:',
      error ?? `No app setting found for key: ${key}`
    )
    return defaultValue
  }

  return data.value as T
}

export async function setAppSetting(key: string, value: Json): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase.from('app_settings').upsert({
    key,
    value,
    updated_at: new Date().toISOString(),
  })

  if (error) throw error
}
