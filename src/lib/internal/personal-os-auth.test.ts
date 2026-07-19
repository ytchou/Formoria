import { afterEach, describe, expect, it } from 'vitest'
import { isPersonalOsRequestAuthorized } from './personal-os-auth'

describe('isPersonalOsRequestAuthorized', () => {
  afterEach(() => {
    delete process.env.PERSONAL_OS_INTERNAL_TOKEN
  })

  it('accepts the configured bearer token', () => {
    process.env.PERSONAL_OS_INTERNAL_TOKEN = 'shared-secret'
    const request = new Request('http://localhost/api/internal/personal-os/executive', {
      headers: { authorization: 'Bearer shared-secret' },
    })

    expect(isPersonalOsRequestAuthorized(request)).toBe(true)
  })

  it.each([undefined, '', 'Bearer wrong', 'Basic shared-secret'])(
    'rejects invalid authorization %s',
    (authorization) => {
      process.env.PERSONAL_OS_INTERNAL_TOKEN = 'shared-secret'
      const headers = authorization ? { authorization } : undefined
      const request = new Request('http://localhost/api/internal/personal-os/executive', { headers })

      expect(isPersonalOsRequestAuthorized(request)).toBe(false)
    },
  )

  it('rejects requests when the server token is unconfigured', () => {
    const request = new Request('http://localhost/api/internal/personal-os/executive', {
      headers: { authorization: 'Bearer anything' },
    })

    expect(isPersonalOsRequestAuthorized(request)).toBe(false)
  })
})
