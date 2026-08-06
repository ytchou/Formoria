import { routing } from '@/i18n/routing'

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
