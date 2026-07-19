import { createClient } from '@supabase/supabase-js'
import type { Json } from '@/lib/supabase/database.types'
import { createServiceClient } from '@/lib/supabase/server'

export type FeatureFlag = {
  key: string
  label: string
  description: string
  defaultValue: boolean
  revalidatePaths: string[]
}

export const FEATURE_FLAGS: FeatureFlag[] = [
  {
    key: 'subcategory_filter_enabled',
    label: 'Subcategory filter on /brands',
    description: 'Shows product-type chips in the directory filter sidebar',
    defaultValue: true,
    revalidatePaths: ['/brands', '/en/brands', '/admin'],
  },
]

export const SUBCATEGORY_FILTER_KEY = FEATURE_FLAGS[0].key

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

  if (error) {
    console.error('getAppSetting query error:', error)
    return defaultValue
  }
  if (!data) {
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
