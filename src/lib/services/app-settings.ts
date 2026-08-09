import { cache } from 'react'
import type { Json } from '@/lib/supabase/database.types'
import { createServiceClient } from '@/lib/supabase/service'
import { OWNER_FEATURES_KEY } from './app-settings-config'
export {
  FEATURE_FLAGS,
  OWNER_FEATURES_KEY,
} from './app-settings-config'

export async function getAppSetting<T extends Json = Json>(
  key: string,
  defaultValue?: T
): Promise<T | undefined> {
  const supabase = createServiceClient()
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

/**
 * Fail-closed read of the owner-features kill switch. A missing row, a query
 * error, or any stored jsonb that is not literally `true` resolves to `false`,
 * so owner surfaces stay hidden by default — the strict `=== true` also stops a
 * truthy non-boolean (e.g. the string `"false"` written by a manual SQL fix)
 * from unlocking every guard. React `cache` collapses repeat reads within one
 * request into a single round trip.
 */
export const isOwnerFeaturesEnabled = cache(
  async (): Promise<boolean> =>
    (await getAppSetting<Json>(OWNER_FEATURES_KEY, false)) === true
)

export async function setAppSetting(key: string, value: Json): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase.from('app_settings').upsert({
    key,
    value,
    updated_at: new Date().toISOString(),
  })

  if (error) throw error
}
