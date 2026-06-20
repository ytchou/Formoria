import { describe, expect, it } from 'vitest'
import { signCookieValue, verifyCookieValue } from './cookie-signing'

describe('cookie-signing', () => {
  const secret = 'test-cookie-secret'

  it('signs and verifies a cookie value', async () => {
    const signed = await signCookieValue('god', secret)

    expect(signed).toBe('god.to5683r36sGosEw0QxLbAT7Hh-bWN3IcNsGE1IDTlaA')
    expect(signed).not.toBe('god')
    expect(await verifyCookieValue(signed, secret)).toBe('god')
  })

  it('returns null for tampered values', async () => {
    const signed = await signCookieValue('viewer', secret)
    const tampered = signed.replace('viewer', 'god')

    expect(await verifyCookieValue(tampered, secret)).toBeNull()
  })

  it('returns null for unsigned plain values', async () => {
    expect(await verifyCookieValue('god', secret)).toBeNull()
  })

  it('returns null for empty or missing values', async () => {
    expect(await verifyCookieValue('', secret)).toBeNull()
    expect(await verifyCookieValue(undefined as unknown as string, secret)).toBeNull()
  })

  it('handles different values correctly', async () => {
    const godCookie = await signCookieValue('god', secret)
    const viewerCookie = await signCookieValue('viewer', secret)

    expect(viewerCookie).toBe('viewer.kXn1r08hEgvs1PPsJ7zejFjiiLW9yjmPAWnLoqv9AUw')
    expect(await verifyCookieValue(godCookie, secret)).toBe('god')
    expect(await verifyCookieValue(viewerCookie, secret)).toBe('viewer')
    expect(godCookie).not.toBe(viewerCookie)
  })
})
