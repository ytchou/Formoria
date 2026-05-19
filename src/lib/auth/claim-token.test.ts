import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateClaimToken, verifyClaimToken } from './claim-token'

describe('claim-token', () => {
  const TEST_SECRET = 'test-secret-at-least-32-chars-long!!'
  const brandId = '550e8400-e29b-41d4-a716-446655440000'
  const email = 'owner@example.com'
  const brandName = 'Formosa Tea Co.'

  beforeEach(() => {
    vi.stubEnv('CLAIM_TOKEN_SECRET', TEST_SECRET)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('generateClaimToken', () => {
    it('returns a non-empty string', async () => {
      const token = await generateClaimToken(brandId, email, brandName)
      expect(token).toBeTruthy()
      expect(typeof token).toBe('string')
    })
  })

  describe('verifyClaimToken', () => {
    it('returns brandId and email for a valid token', async () => {
      const token = await generateClaimToken(brandId, email, brandName)
      const result = await verifyClaimToken(token)
      expect(result).toEqual({ brandId, email })
    })

    it('returns null for a tampered token', async () => {
      const token = await generateClaimToken(brandId, email, brandName)
      const tampered = token.slice(0, -5) + 'XXXXX'
      const result = await verifyClaimToken(tampered)
      expect(result).toBeNull()
    })

    it('returns null for a completely invalid string', async () => {
      const result = await verifyClaimToken('not-a-jwt')
      expect(result).toBeNull()
    })

    it('returns null when email does not match', async () => {
      const token = await generateClaimToken(brandId, email, brandName)
      const result = await verifyClaimToken(token)
      expect(result?.email).toBe(email)
      expect(result?.email).not.toBe('other@example.com')
    })
  })

  describe('missing secret', () => {
    it('throws when CLAIM_TOKEN_SECRET is not set', async () => {
      vi.stubEnv('CLAIM_TOKEN_SECRET', '')
      await expect(generateClaimToken(brandId, email)).rejects.toThrow()
    })
  })
})
