import { describe, expect, it } from 'vitest'
import { FEATURE_FLAGS, OWNER_FEATURES_KEY } from './app-settings'


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

  it('registers owner_features_enabled as an off-by-default flag', () => {
    const flag = FEATURE_FLAGS.find((f) => f.key === OWNER_FEATURES_KEY)
    expect(OWNER_FEATURES_KEY).toBe('owner_features_enabled')
    expect(flag?.defaultValue).toBe(false)
    expect(flag?.revalidatePaths).toContain('/admin/settings')
  })
})
