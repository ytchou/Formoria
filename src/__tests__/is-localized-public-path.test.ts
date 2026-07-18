import { describe, it, expect } from 'vitest'
import { isLocalizedPublicPath } from '@/proxy'

describe('isLocalizedPublicPath', () => {
  it('treats moved app routes as localized (prefix-free + /en)', () => {
    expect(isLocalizedPublicPath('/submit')).toBe(true)
    expect(isLocalizedPublicPath('/en/submit')).toBe(true)
    expect(isLocalizedPublicPath('/my-submissions')).toBe(true)
    expect(isLocalizedPublicPath('/en/my-submissions')).toBe(true)
    expect(isLocalizedPublicPath('/dashboard')).toBe(true)
    expect(isLocalizedPublicPath('/en/dashboard')).toBe(true)
    expect(isLocalizedPublicPath('/challenge')).toBe(true)
    expect(isLocalizedPublicPath('/en/challenge')).toBe(true)
  })

  it('still excludes non-localized routes', () => {
    expect(isLocalizedPublicPath('/auth/sign-in')).toBe(false)
    expect(isLocalizedPublicPath('/admin')).toBe(false)
  })
})
