import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAuthorizedMachineCaller } from './machine-caller'

describe('isAuthorizedMachineCaller', () => {
  const url = 'https://formoria.com/api/cron/claim-proof-cleanup'
  const secret = 's3cr3t-cron-token'
  const originalOriginSecret = process.env.ORIGIN_SECRET

  afterEach(() => {
    vi.unstubAllEnvs()
    if (originalOriginSecret === undefined) {
      delete process.env.ORIGIN_SECRET
    } else {
      process.env.ORIGIN_SECRET = originalOriginSecret
    }
  })

  it('accepts a matching configured secret', () => {
    vi.stubEnv('ORIGIN_SECRET', secret)
    const request = new Request(url, {
      headers: { 'x-origin-verify': secret },
    })

    expect(isAuthorizedMachineCaller(request)).toBe(true)
  })

  it('rejects a wrong secret', () => {
    vi.stubEnv('ORIGIN_SECRET', secret)
    const request = new Request(url, {
      headers: { 'x-origin-verify': 'mch_2026_08_1a6e9c4d8b2f7a0e5c3d1b9f' },
    })

    expect(isAuthorizedMachineCaller(request)).toBe(false)
  })

  it('rejects a request without a verification header', () => {
    vi.stubEnv('ORIGIN_SECRET', secret)
    const request = new Request(url)

    expect(isAuthorizedMachineCaller(request)).toBe(false)
  })

  it('rejects absent and empty headers when the secret is unset', () => {
    delete process.env.ORIGIN_SECRET
    const absentRequest = new Request(url)
    const emptyRequest = new Request(url, {
      headers: { 'x-origin-verify': '' },
    })

    expect(isAuthorizedMachineCaller(absentRequest)).toBe(false)
    expect(isAuthorizedMachineCaller(emptyRequest)).toBe(false)
  })

  // Regression: five cron routes authorized any caller when ORIGIN_SECRET was ''.
  it('rejects absent, empty, and nonempty headers when the secret is empty', () => {
    vi.stubEnv('ORIGIN_SECRET', '')
    const absentRequest = new Request(url)
    const emptyRequest = new Request(url, {
      headers: { 'x-origin-verify': '' },
    })
    const nonemptyRequest = new Request(url, {
      headers: { 'x-origin-verify': secret },
    })

    expect(isAuthorizedMachineCaller(absentRequest)).toBe(false)
    expect(isAuthorizedMachineCaller(emptyRequest)).toBe(false)
    expect(isAuthorizedMachineCaller(nonemptyRequest)).toBe(false)
  })

  it('rejects absent, whitespace, and nonempty headers when the secret is whitespace-only', () => {
    vi.stubEnv('ORIGIN_SECRET', '   ')
    const absentRequest = new Request(url)
    const whitespaceRequest = new Request(url, {
      headers: { 'x-origin-verify': '   ' },
    })
    const nonemptyRequest = new Request(url, {
      headers: { 'x-origin-verify': secret },
    })

    expect(isAuthorizedMachineCaller(absentRequest)).toBe(false)
    expect(isAuthorizedMachineCaller(whitespaceRequest)).toBe(false)
    expect(isAuthorizedMachineCaller(nonemptyRequest)).toBe(false)
  })

  // Only the env var is trimmed -- a stray newline in the Railway variable
  // must not lock every cron job out. The header is compared verbatim, which
  // keeps this identical to the already-hardened revalidate-brands route.
  it('trims surrounding whitespace in the configured secret', () => {
    vi.stubEnv('ORIGIN_SECRET', `  ${secret}  `)
    const request = new Request(url, {
      headers: { 'x-origin-verify': secret },
    })

    expect(isAuthorizedMachineCaller(request)).toBe(true)
  })
})
