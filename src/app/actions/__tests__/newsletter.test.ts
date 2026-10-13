import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { subscribeToNewsletter } from '../newsletter'
import { parseSubscribeForm, isHoneypotFilled } from '../newsletter-helpers'
import {
  createInMemoryRateLimiter,
  setRateLimitStoreForTests,
} from '@/lib/security/rate-limiter'

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}))

beforeEach(() => {
  setRateLimitStoreForTests(createInMemoryRateLimiter())
})

afterEach(() => {
  setRateLimitStoreForTests(null)
})

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

describe('newsletter server action', () => {
  it('returns a stable error code for an invalid email', async () => {
    const formData = new FormData()
    formData.set('email', 'not an email')

    await expect(subscribeToNewsletter({}, formData)).resolves.toEqual({
      error: 'invalidEmail',
    })
  })

  it('returns a stable retry code after the per-IP limit is reached', async () => {
    const formData = new FormData()
    formData.set('email', 'not an email')

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(subscribeToNewsletter({}, formData)).resolves.toEqual({
        error: 'invalidEmail',
      })
    }

    await expect(subscribeToNewsletter({}, formData)).resolves.toEqual({
      error: 'rateLimited',
    })
  })
})
