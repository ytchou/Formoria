import { afterEach, describe, expect, it } from 'vitest'
import { isBearerAuthorized, isPersonalOsRequestAuthorized } from './personal-os-auth'

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

describe('isBearerAuthorized', () => {
  const ENV_NAME = 'TEST_BEARER_SECRET'

  function requestWith(authorization?: string): Request {
    const headers = authorization ? { authorization } : undefined
    return new Request('http://localhost/api/internal/e2e-dispatch', { headers })
  }

  afterEach(() => {
    delete process.env[ENV_NAME]
  })

  it('rejects when the env var is unset', () => {
    expect(isBearerAuthorized(requestWith('Bearer anything'), ENV_NAME)).toBe(false)
  })

  it('rejects when the env var is blank after trimming', () => {
    process.env[ENV_NAME] = '   '
    expect(isBearerAuthorized(requestWith('Bearer    '), ENV_NAME)).toBe(false)
    expect(isBearerAuthorized(requestWith('Bearer '), ENV_NAME)).toBe(false)
  })

  it('rejects a wrong token', () => {
    process.env[ENV_NAME] = 'shared-secret'
    expect(isBearerAuthorized(requestWith('Bearer wrong'), ENV_NAME)).toBe(false)
  })

  it('rejects a non-Bearer scheme', () => {
    process.env[ENV_NAME] = 'shared-secret'
    expect(isBearerAuthorized(requestWith('Basic shared-secret'), ENV_NAME)).toBe(false)
  })

  it('accepts a matching token', () => {
    process.env[ENV_NAME] = 'shared-secret'
    expect(isBearerAuthorized(requestWith('Bearer shared-secret'), ENV_NAME)).toBe(true)
  })

  it('trims surrounding whitespace from the env value', () => {
    process.env[ENV_NAME] = '  shared-secret\n'
    expect(isBearerAuthorized(requestWith('Bearer shared-secret'), ENV_NAME)).toBe(true)
  })
})
