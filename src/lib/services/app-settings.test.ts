import { afterAll, expect, it } from 'vitest'
import { describeWithDb } from '@/test/setup'
import { getAppSetting, setAppSetting } from './app-settings'

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
