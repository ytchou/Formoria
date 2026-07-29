import { afterAll, describe, expect, it } from 'vitest'
import { createTestClient, describeWithDb } from '@/test/setup'
import {
  FEATURE_FLAGS,
  getAppSetting,
  isOwnerFeaturesEnabled,
  OWNER_FEATURES_KEY,
  setAppSetting,
  SUBCATEGORY_FILTER_KEY,
} from './app-settings'

describeWithDb('app-settings service', () => {
  afterAll(async () => {
    await setAppSetting('subcategory_filter_enabled', true)
    await setAppSetting(OWNER_FEATURES_KEY, false)
  })


  it('round-trips a write', async () => {
    await setAppSetting('subcategory_filter_enabled', false)
    expect(await getAppSetting('subcategory_filter_enabled')).toBe(false)
    await setAppSetting('subcategory_filter_enabled', true)
    expect(await getAppSetting('subcategory_filter_enabled')).toBe(true)
  })

  it('fails open: unknown key returns the provided default', async () => {
    expect(await getAppSetting('nonexistent_key', true)).toBe(true)
  })

  it('isOwnerFeaturesEnabled returns false when the row is missing', async () => {
    const supabase = createTestClient()
    const { error } = await supabase
      .from('app_settings')
      .delete()
      .eq('key', OWNER_FEATURES_KEY)
    expect(error).toBeNull()

    try {
      expect(await isOwnerFeaturesEnabled()).toBe(false)
    } finally {
      await setAppSetting(OWNER_FEATURES_KEY, false)
    }
  })

  it('isOwnerFeaturesEnabled reflects the stored value', async () => {
    await setAppSetting(OWNER_FEATURES_KEY, true)
    expect(await isOwnerFeaturesEnabled()).toBe(true)
    await setAppSetting(OWNER_FEATURES_KEY, false)
    expect(await isOwnerFeaturesEnabled()).toBe(false)
  })
})

describe('feature flag registry', () => {
  it('exports a non-empty FEATURE_FLAGS array', () => {
    expect(FEATURE_FLAGS.length).toBeGreaterThan(0)
  })

  it('every entry has required fields', () => {
    for (const flag of FEATURE_FLAGS) {
      expect(flag.key).toBeTypeOf('string')
      expect(flag.label).toBeTypeOf('string')
      expect(flag.description).toBeTypeOf('string')
      expect(flag.defaultValue).toBeTypeOf('boolean')
      expect(flag.revalidatePaths).toBeInstanceOf(Array)
      expect(flag.revalidatePaths.length).toBeGreaterThan(0)
    }
  })

  it('SUBCATEGORY_FILTER_KEY is derived from the registry', () => {
    expect(SUBCATEGORY_FILTER_KEY).toBe('subcategory_filter_enabled')
    expect(FEATURE_FLAGS.some((f) => f.key === SUBCATEGORY_FILTER_KEY)).toBe(
      true
    )
  })

  it('registers owner_features_enabled as an off-by-default flag', () => {
    const flag = FEATURE_FLAGS.find((f) => f.key === OWNER_FEATURES_KEY)
    expect(OWNER_FEATURES_KEY).toBe('owner_features_enabled')
    expect(flag?.defaultValue).toBe(false)
    expect(flag?.revalidatePaths).toContain('/admin/settings')
  })
})
