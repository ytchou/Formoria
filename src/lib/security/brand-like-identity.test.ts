import { afterEach, describe, expect, it } from 'vitest'

import {
  hashBrandLikeVisitorId,
  signBrandLikeVisitorId,
  verifyBrandLikeVisitorId,
} from './brand-like-identity'

describe('brand-like identity', () => {
  const originalSecret = process.env.CHALLENGE_SECRET
  const visitorId = 'd9428888-122b-4e1f-b85c-61c0a8904d6a'

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CHALLENGE_SECRET
    else process.env.CHALLENGE_SECRET = originalSecret
  })

  it('signs a browser ID and rejects tampering', async () => {
    process.env.CHALLENGE_SECRET = 'test-challenge-secret'
    const signed = await signBrandLikeVisitorId(visitorId)

    await expect(verifyBrandLikeVisitorId(signed)).resolves.toBe(visitorId)
    await expect(
      verifyBrandLikeVisitorId(`${signed.slice(0, -1)}x`),
    ).resolves.toBeNull()
  })

  it('stores a one-way fixed-length hash instead of the browser ID', async () => {
    const hash = await hashBrandLikeVisitorId(visitorId)

    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain(visitorId)
  })
})
