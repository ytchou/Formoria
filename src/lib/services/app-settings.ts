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

// Flag keys are declared before the registry so each key has exactly one
// source of truth: helpers resolve by key, never by position in the array.
export const SUBCATEGORY_FILTER_KEY = 'subcategory_filter_enabled'

export const OWNER_FEATURES_KEY = 'owner_features_enabled'

export const FEATURE_FLAGS: FeatureFlag[] = [
  {
    key: SUBCATEGORY_FILTER_KEY,
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
  {
    key: OWNER_FEATURES_KEY,
    label: 'Owner features',
    description:
      'Enables brand claiming and the owner dashboard; off hides both surfaces',
    defaultValue: false,
    // Owner surfaces are gated per-request, so only the toggle page needs busting.
    revalidatePaths: ['/admin/settings'],
  },
]

// Reads run on the request hot path (page gates, server actions, viewer
// context), so reuse one anon client instead of constructing a supabase-js
// client plus its GoTrue auth client per call. Mirrors `createServiceClient`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _anonClient: ReturnType<typeof createClient<any>> | null = null

function getAnonClient() {
  if (!_anonClient) {
    _anonClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }
  return _anonClient
}

export async function getAppSetting<T extends Json = Json>(
  key: string,
  defaultValue?: T
): Promise<T | undefined> {
  const supabase = getAnonClient()
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
