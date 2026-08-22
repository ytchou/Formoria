import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

import {
  BRAND_LIKE_VISITOR_COOKIE,
  signBrandLikeVisitorId,
  verifyBrandLikeVisitorId,
} from '../brand-like-identity'
import {
  VISITOR_COOKIE_NAME,
  createVisitorId,
  resolveVisitorIdentity,
  signVisitorId,
  verifyVisitorId,
} from '../visitor-identity'

// The secret is read once per module and cached, so it has to be in place
// before the first sign/verify call in this file.
beforeAll(() => {
  process.env.CHALLENGE_SECRET = 'test-challenge-secret'
})

describe('visitor identity', () => {
  it('mints a signed id when absent', async () => {
    const resolved = await resolveVisitorIdentity(undefined)

    expect(resolved.minted).toBe(true)
    expect(resolved.visitorId).toMatch(/^[0-9a-f-]{36}$/)
    await expect(verifyVisitorId(resolved.signedValue)).resolves.toBe(
      resolved.visitorId,
    )
  })

  it('reuses an existing valid cookie without minting', async () => {
    const signed = await signVisitorId(createVisitorId())
    const resolved = await resolveVisitorIdentity(signed)

    expect(resolved.minted).toBe(false)
    expect(resolved.signedValue).toBe(signed)
  })

  it('rejects a tampered signature', async () => {
    const signed = await signVisitorId(createVisitorId())
    const separatorIndex = signed.lastIndexOf('.')
    const payload = signed.slice(0, separatorIndex)
    const signature = signed.slice(separatorIndex + 1)
    // Mutate the payload, keep the signature: the HMAC no longer covers it.
    const tampered = `${payload.slice(0, -1)}${payload.endsWith('a') ? 'b' : 'a'}.${signature}`

    await expect(verifyVisitorId(tampered)).resolves.toBeNull()

    const resolved = await resolveVisitorIdentity(tampered)
    expect(resolved.minted).toBe(true)
    expect(resolved.signedValue).not.toBe(tampered)
    await expect(verifyVisitorId(resolved.signedValue)).resolves.toBe(
      resolved.visitorId,
    )
  })

  it('is domain-separated from fm_like_visitor', async () => {
    expect(VISITOR_COOKIE_NAME).toBe('fm_visitor')
    expect(VISITOR_COOKIE_NAME).not.toBe(BRAND_LIKE_VISITOR_COOKIE)

    const id = createVisitorId()
    const signedForVisitor = await signVisitorId(id)
    const signedForLikes = await signBrandLikeVisitorId(id)

    expect(signedForVisitor).not.toBe(signedForLikes)
    await expect(verifyVisitorId(signedForLikes)).resolves.toBeNull()
    await expect(verifyBrandLikeVisitorId(signedForVisitor)).resolves.toBeNull()
  })

  it('works in the edge runtime', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../visitor-identity.ts', import.meta.url)),
      'utf8',
    )

    expect(source).not.toMatch(/from ['"]node:/)
    expect(source).not.toMatch(/require\(/)
    expect(source).not.toMatch(/from ['"](crypto|buffer|util|fs|stream)['"]/)
    expect(source).toContain('crypto.subtle')
    // The shared signing primitives are reused rather than hand-rolled.
    expect(source).toContain('cookie-signing')
  })
})
