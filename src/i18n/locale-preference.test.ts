import { describe, expect, it } from 'vitest'
import {
  localizePath,
  readOnlyStagingLocaleHref,
  resolveAuthenticatedLocale,
  resolveInitialLocale,
} from './locale-preference'

describe('locale preference', () => {
  it('prioritizes a stored preference over request signals', () => {
    expect(resolveInitialLocale({
      cookieLocale: 'en',
      acceptLanguage: 'zh-TW',
      country: 'TW',
    })).toBe('en')
  })

  it('prefers Taiwan geography over an English browser UI', () => {
    expect(resolveInitialLocale({
      acceptLanguage: 'en-US,en;q=0.9,zh-TW;q=0.8',
      country: 'TW',
    })).toBe('zh-TW')
    expect(resolveInitialLocale({
      acceptLanguage: 'fr-FR,en-US;q=0.9,zh-TW;q=0.8',
      country: 'TW',
    })).toBe('zh-TW')
    expect(resolveInitialLocale({
      acceptLanguage: 'zh-TW,zh;q=0.9,en;q=0.8',
      country: 'US',
    })).toBe('zh-TW')
  })

  it('chooses the highest-ranked supported browser language', () => {
    expect(resolveInitialLocale({
      acceptLanguage: 'ja-JP,zh-TW;q=0.9,en;q=0.8',
      country: 'US',
    })).toBe('zh-TW')
  })

  it('keeps browser language in charge for visitors outside Taiwan', () => {
    expect(resolveInitialLocale({
      acceptLanguage: 'en-US,en;q=0.9',
      country: 'JP',
    })).toBe('en')
    expect(resolveInitialLocale({
      acceptLanguage: 'zh-TW,zh;q=0.9',
      country: 'JP',
    })).toBe('zh-TW')
  })

  it('falls back to country when no browser language is present', () => {
    expect(resolveInitialLocale({ country: 'TW' })).toBe('zh-TW')
    expect(resolveInitialLocale({ country: 'US' })).toBe('en')
  })

  it('falls back to country, then the configured default, when no supported language exists', () => {
    expect(resolveInitialLocale({
      acceptLanguage: 'ja-JP,fr-FR;q=0.9',
      country: 'TW',
    })).toBe('zh-TW')
    expect(resolveInitialLocale({
      acceptLanguage: 'ja-JP,fr-FR;q=0.9',
      country: 'US',
    })).toBe('en')
    expect(resolveInitialLocale({})).toBe('zh-TW')
  })

  it('uses locale-prefixed paths only for English', () => {
    expect(localizePath('/dashboard', 'en')).toBe('/en/dashboard')
    expect(localizePath('/dashboard', 'zh-TW')).toBe('/dashboard')
    expect(localizePath('/en/dashboard', 'en')).toBe('/en/dashboard')
    expect(localizePath('/en/dashboard', 'zh-TW')).toBe('/dashboard')
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
