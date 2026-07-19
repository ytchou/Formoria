import { afterAll, describe, expect, it } from 'vitest'
import { describeWithDb } from '@/test/setup'
import {
  FEATURE_FLAGS,
  getAppSetting,
  setAppSetting,
  SUBCATEGORY_FILTER_KEY,
} from './app-settings'

describeWithDb('app-settings service', () => {
  afterAll(async () => {
    await setAppSetting('subcategory_filter_enabled', true)
  })

  it('reads the seeded subcategory flag', async () => {
    const value = await getAppSetting('subcategory_filter_enabled')
    expect(typeof value).toBe('boolean')
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
})
