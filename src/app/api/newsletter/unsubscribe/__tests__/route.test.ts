import { describe, it, expect } from 'vitest'
import { extractToken } from '../route'

describe('newsletter unsubscribe route — helpers', () => {
  describe('extractToken', () => {
    it('extracts token from search params', () => {
      const url = new URL('http://localhost/api/newsletter/unsubscribe?token=xyz-789')
      expect(extractToken(url)).toBe('xyz-789')
    })

    it('returns null for missing token', () => {
      const url = new URL('http://localhost/api/newsletter/unsubscribe')
      expect(extractToken(url)).toBeNull()
    })
  })
})
