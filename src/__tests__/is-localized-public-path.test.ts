import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { isLocalizedPublicPath, proxy } from '@/proxy'

describe('isLocalizedPublicPath', () => {
  it('treats moved app routes as localized (prefix-free + /en)', () => {
    expect(isLocalizedPublicPath('/submit')).toBe(true)
    expect(isLocalizedPublicPath('/en/submit')).toBe(true)
    expect(isLocalizedPublicPath('/contributions')).toBe(true)
    expect(isLocalizedPublicPath('/en/contributions')).toBe(true)
    expect(isLocalizedPublicPath('/settings')).toBe(true)
    expect(isLocalizedPublicPath('/en/settings')).toBe(true)
    expect(isLocalizedPublicPath('/challenge')).toBe(true)
    expect(isLocalizedPublicPath('/en/challenge')).toBe(true)
  })

  it('treats auth pages as localized now that they live under [locale]', () => {
    expect(isLocalizedPublicPath('/auth/sign-in')).toBe(true)
    expect(isLocalizedPublicPath('/en/auth/sign-in')).toBe(true)
  })

  it('leaves non-localized auth route handlers outside locale middleware', () => {
    expect(isLocalizedPublicPath('/auth/callback')).toBe(false)
    expect(isLocalizedPublicPath('/auth/sign-out')).toBe(false)
  })

  it('lets the sign-out POST reach its top-level route handler', async () => {
    const request = new NextRequest('https://formoria.com/auth/sign-out', {
      method: 'POST',
      headers: { host: 'formoria.com' },
    })

    const response = await proxy(request)

    expect(response.headers.get('x-middleware-rewrite')).toBeNull()
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })

  it('treats /events as localized', () => {
    // Missing from PUBLIC_INTL_SEGMENTS, the prefix-free (zh-TW) hub loses locale
    // inference in production only — dev and /en both look fine.
    expect(isLocalizedPublicPath('/events')).toBe(true)
    expect(isLocalizedPublicPath('/en/events')).toBe(true)
  })

  it('still excludes non-localized routes', () => {
    expect(isLocalizedPublicPath('/admin')).toBe(false)
  })
})
