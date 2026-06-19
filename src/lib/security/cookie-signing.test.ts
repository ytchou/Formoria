import { describe, expect, it } from 'vitest'
import { signCookieValue, verifyCookieValue } from './cookie-signing'

describe('cookie-signing', () => {
  const secret = 'test-cookie-secret'

  it('signs and verifies a cookie value', () => {
    const signed = signCookieValue('god', secret)

    expect(signed).not.toBe('god')
    expect(verifyCookieValue(signed, secret)).toBe('god')
  })

  it('returns null for tampered values', () => {
    const signed = signCookieValue('viewer', secret)
    const tampered = signed.replace('viewer', 'god')

    expect(verifyCookieValue(tampered, secret)).toBeNull()
  })

  it('returns null for unsigned plain values', () => {
    expect(verifyCookieValue('god', secret)).toBeNull()
  })

  it('returns null for empty or missing values', () => {
    expect(verifyCookieValue('', secret)).toBeNull()
    expect(verifyCookieValue(undefined as unknown as string, secret)).toBeNull()
  })

  it('handles different values correctly', () => {
    const godCookie = signCookieValue('god', secret)
    const viewerCookie = signCookieValue('viewer', secret)

    expect(verifyCookieValue(godCookie, secret)).toBe('god')
    expect(verifyCookieValue(viewerCookie, secret)).toBe('viewer')
    expect(godCookie).not.toBe(viewerCookie)
  })
})
