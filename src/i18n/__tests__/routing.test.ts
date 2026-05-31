import { describe, expect, it } from 'vitest'

import { routing } from '@/i18n/routing'

describe('i18n routing config', () => {
  it('declares zh-TW (default) and en with as-needed prefix and no auto-detection', () => {
    expect(routing.locales).toEqual(['zh-TW', 'en'])
    expect(routing.defaultLocale).toBe('zh-TW')
    expect(routing.localePrefix).toBe('as-needed')
    expect(routing.localeDetection).toBe(false)
  })
})
