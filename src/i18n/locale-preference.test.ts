import { describe, expect, it } from 'vitest'
import { localizePath, resolveInitialLocale } from './locale-preference'

describe('locale preference', () => {
  it('prioritizes a stored preference over request signals', () => {
    expect(resolveInitialLocale({
      cookieLocale: 'en',
      acceptLanguage: 'zh-TW',
      country: 'TW',
    })).toBe('en')
  })

  it('respects Accept-Language quality before country', () => {
    expect(resolveInitialLocale({
      acceptLanguage: 'en-US,en;q=0.9,zh-TW;q=0.8',
      country: 'TW',
    })).toBe('en')
    expect(resolveInitialLocale({
      acceptLanguage: 'zh-TW,zh;q=0.9,en;q=0.8',
      country: 'US',
    })).toBe('zh-TW')
  })

  it('uses country only when browser language is unavailable', () => {
    expect(resolveInitialLocale({ country: 'TW' })).toBe('zh-TW')
    expect(resolveInitialLocale({ country: 'US' })).toBe('en')
  })

  it('uses locale-prefixed paths only for English', () => {
    expect(localizePath('/dashboard', 'en')).toBe('/en/dashboard')
    expect(localizePath('/dashboard', 'zh-TW')).toBe('/dashboard')
    expect(localizePath('/en/dashboard', 'en')).toBe('/en/dashboard')
    expect(localizePath('/en/dashboard', 'zh-TW')).toBe('/dashboard')
  })
})
