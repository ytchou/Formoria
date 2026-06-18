import { describe, it, expect } from 'vitest'
import { extractToken, buildConfirmRedirectUrl } from '../route'

describe('newsletter confirm route — helpers', () => {
  describe('extractToken', () => {
    it('extracts token from search params', () => {
      const url = new URL('http://localhost/api/newsletter/confirm?token=abc-123')
      expect(extractToken(url)).toBe('abc-123')
    })

    it('returns null for missing token', () => {
      const url = new URL('http://localhost/api/newsletter/confirm')
      expect(extractToken(url)).toBeNull()
    })
  })

  describe('buildConfirmRedirectUrl', () => {
    it('appends subscribed=true to homepage', () => {
      const url = buildConfirmRedirectUrl('http://localhost')
      expect(url).toBe('http://localhost/?subscribed=true')
    })
  })
})
