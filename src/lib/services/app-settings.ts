import { cache } from 'react'
import { createClient } from '@supabase/supabase-js'
import { routing } from '@/i18n/routing'
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
    // The ISR cache key keeps the locale prefix even where the URL hides it,
    // so a bare `/brands` matches nothing. See `revalidateLocalizedPath`.
    revalidatePaths: [
      ...routing.locales.map((locale) => `/${locale}/brands`),
      '/admin/settings',
    ],
  },
  // Keep new flags appended: `SUBCATEGORY_FILTER_KEY` reads `FEATURE_FLAGS[0]`.
  {
    key: 'owner_features_enabled',
    label: 'Owner features',
    description:
      'Enables brand claiming and the owner dashboard; off hides both surfaces',
    defaultValue: false,
    // Owner surfaces are gated per-request, so only the toggle page needs busting.
    revalidatePaths: ['/admin/settings'],
  },
]

export const SUBCATEGORY_FILTER_KEY = FEATURE_FLAGS[0].key

export const OWNER_FEATURES_KEY = 'owner_features_enabled'

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

/**
 * Fail-closed read of the owner-features kill switch. A missing row or a query
 * error resolves to `false`, so owner surfaces stay hidden by default. React
 * `cache` collapses repeat reads within one request into a single round trip.
 */
export const isOwnerFeaturesEnabled = cache(
  async (): Promise<boolean> =>
    (await getAppSetting<boolean>(OWNER_FEATURES_KEY, false)) ?? false
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
