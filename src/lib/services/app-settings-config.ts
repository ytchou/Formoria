export type FeatureFlag = {
  key: string
  label: string
  description: string
  defaultValue: boolean
  revalidatePaths: string[]
}

export const OWNER_FEATURES_KEY = 'owner_features_enabled'

export const FEATURE_FLAGS: FeatureFlag[] = [
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
