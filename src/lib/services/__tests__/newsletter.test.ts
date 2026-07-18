import { describe, it, expect, beforeEach } from 'vitest'
import {
  normalizeEmail,
  validateEmail,
  VALID_INTERESTS,
  normalizeInterests,
  deriveNewsletterStatus,
  calculateConfirmationRate,
} from '../newsletter'

describe('newsletter service — pure functions', () => {
  beforeEach(() => undefined)

  describe('normalizeEmail', () => {
    it('lowercases and trims email', () => {
      expect(normalizeEmail('  User@Example.COM  ')).toBe('user@example.com')
    })
  })

  describe('validateEmail', () => {
    it('accepts valid email', () => {
      expect(validateEmail('user@example.com')).toBe(true)
    })

    it('rejects invalid email', () => {
      expect(validateEmail('not-an-email')).toBe(false)
      expect(validateEmail('')).toBe(false)
      expect(validateEmail('a@')).toBe(false)
    })
  })

  describe('normalizeInterests', () => {
    it('filters to valid interest slugs', () => {
      expect(normalizeInterests(['brand-stories', 'invalid', 'new-brands']))
        .toEqual(['brand-stories', 'new-brands'])
    })

    it('returns empty array for all invalid', () => {
      expect(normalizeInterests(['foo', 'bar'])).toEqual([])
    })

    it('deduplicates', () => {
      expect(normalizeInterests(['new-brands', 'new-brands'])).toEqual(['new-brands'])
    })
  })

  describe('VALID_INTERESTS', () => {
    it('contains exactly 4 interest slugs', () => {
      expect(VALID_INTERESTS).toHaveLength(4)
      expect(VALID_INTERESTS).toContain('brand-stories')
      expect(VALID_INTERESTS).toContain('new-brands')
      expect(VALID_INTERESTS).toContain('curated-picks')
      expect(VALID_INTERESTS).toContain('mit-trends')
    })
  })

  it('gives unsubscribe precedence and calculates active conversion', () => {
    expect(deriveNewsletterStatus({ confirmed_at: null, unsubscribed_at: null })).toBe('pending')
    expect(deriveNewsletterStatus({ confirmed_at: '2026-07-18', unsubscribed_at: null })).toBe('active')
    expect(deriveNewsletterStatus({ confirmed_at: '2026-07-18', unsubscribed_at: '2026-07-19' })).toBe('unsubscribed')
    expect(calculateConfirmationRate({ active: 3, pending: 1 })).toBe(75)
    expect(calculateConfirmationRate({ active: 0, pending: 0 })).toBe(0)
  })
})
