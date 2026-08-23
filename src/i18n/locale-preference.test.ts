import { describe, expect, it } from 'vitest'
import {
  localizePath,
  readOnlyStagingLocaleHref,
  resolveAuthenticatedLocale,
} from './locale-preference'

describe('locale preference', () => {
  it('uses locale-prefixed paths only for English', () => {
    expect(localizePath('/settings', 'en')).toBe('/en/settings')
    expect(localizePath('/settings', 'zh-TW')).toBe('/settings')
    expect(localizePath('/en/settings', 'en')).toBe('/en/settings')
    expect(localizePath('/en/settings', 'zh-TW')).toBe('/settings')
  })

  it('preserves query and fragment when a visitor switches locale from either homepage', () => {
    expect(localizePath('/en?campaign=summer#brands', 'zh-TW')).toBe(
      '/?campaign=summer#brands',
    )
    expect(localizePath('/?campaign=summer#brands', 'en')).toBe(
      '/en?campaign=summer#brands',
    )
  })

  it('gives staging a GET destination while production keeps the preference action', () => {
    const currentUrl = '/brands?tag=rice%2Fgrains&tag=gift%20boxes#results'

    expect(readOnlyStagingLocaleHref(currentUrl, 'en', 'staging')).toBe(
      '/en/brands?tag=rice%2Fgrains&tag=gift%20boxes#results',
    )
    expect(readOnlyStagingLocaleHref(currentUrl, 'en', 'production')).toBeNull()
  })

  it('restores a returning user profile locale while new users keep their auth intent', () => {
    expect(resolveAuthenticatedLocale({
      isNewUser: false,
      profileLocale: 'zh-TW',
      intendedLocale: 'en',
    })).toBe('zh-TW')
    expect(resolveAuthenticatedLocale({
      isNewUser: true,
      profileLocale: 'zh-TW',
      intendedLocale: 'en',
    })).toBe('en')
    expect(resolveAuthenticatedLocale({
      isNewUser: true,
      profileLocale: 'en',
    })).toBe('en')
  })
})
