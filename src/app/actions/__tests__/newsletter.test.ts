import { describe, it, expect } from 'vitest'
import { parseSubscribeForm, isHoneypotFilled } from '../newsletter-helpers'

describe('newsletter server action — pure helpers', () => {
  describe('parseSubscribeForm', () => {
    it('extracts email and interests from FormData', () => {
      const fd = new FormData()
      fd.set('email', 'user@example.com')
      fd.append('interests', 'brand-stories')
      fd.append('interests', 'new-brands')

      const result = parseSubscribeForm(fd)
      expect(result.email).toBe('user@example.com')
      expect(result.interests).toEqual(['brand-stories', 'new-brands'])
    })

    it('returns empty interests if none selected', () => {
      const fd = new FormData()
      fd.set('email', 'user@example.com')

      const result = parseSubscribeForm(fd)
      expect(result.interests).toEqual([])
    })
  })

  describe('isHoneypotFilled', () => {
    it('returns false when honeypot is empty', () => {
      const fd = new FormData()
      fd.set('website', '')
      expect(isHoneypotFilled(fd)).toBe(false)
    })

    it('returns true when honeypot has value', () => {
      const fd = new FormData()
      fd.set('website', 'http://spam.com')
      expect(isHoneypotFilled(fd)).toBe(true)
    })

    it('returns false when honeypot field missing', () => {
      const fd = new FormData()
      expect(isHoneypotFilled(fd)).toBe(false)
    })
  })
})
