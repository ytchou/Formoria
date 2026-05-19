import { describe, it, expect } from 'vitest'
import { checkContent } from './moderation'

describe('moderation service', () => {
  describe('checkContent', () => {
    it('returns clean result for normal content', () => {
      const result = checkContent({
        name: 'My Brand',
        description: 'We make handcrafted ceramics in Yingge.',
      })
      expect(result.blocked).toEqual([])
      expect(result.flagged).toEqual([])
      expect(result.isBlocked).toBe(false)
    })

    it('blocks content with Tier 1 terms', () => {
      const result = checkContent({
        description: 'Buy cheap viagra now!!!',
      })
      expect(result.isBlocked).toBe(true)
      expect(result.blocked.length).toBeGreaterThan(0)
      expect(result.blocked[0].field).toBe('description')
      expect(result.blocked[0].reason).toBeTruthy()
    })

    it('flags content with excessive URLs (Tier 2)', () => {
      const result = checkContent({
        description:
          'Visit http://a.com and http://b.com and http://c.com and http://d.com for deals',
      })
      expect(result.isBlocked).toBe(false)
      expect(result.flagged.length).toBeGreaterThan(0)
      expect(result.flagged[0].field).toBe('description')
      expect(result.flagged[0].tier).toBe('flag')
    })

    it('flags all-caps blocks (Tier 2)', () => {
      const result = checkContent({
        description: 'THIS IS ALL CAPS AND VERY LONG SHOUTING TEXT BLOCK HERE',
      })
      expect(result.isBlocked).toBe(false)
      expect(result.flagged.length).toBeGreaterThan(0)
    })

    it('checks multiple fields independently', () => {
      const result = checkContent({
        name: 'Normal Name',
        description: 'Buy cheap viagra now!!!',
      })
      expect(result.blocked.length).toBe(1)
      expect(result.blocked[0].field).toBe('description')
    })

    it('handles empty fields gracefully', () => {
      const result = checkContent({})
      expect(result.blocked).toEqual([])
      expect(result.flagged).toEqual([])
      expect(result.isBlocked).toBe(false)
    })

    it('returns both blocked and flagged results when both apply', () => {
      const result = checkContent({
        name: 'Buy cheap viagra',
        description:
          'Visit http://a.com http://b.com http://c.com http://d.com',
      })
      expect(result.blocked.length).toBeGreaterThan(0)
      expect(result.flagged.length).toBeGreaterThan(0)
      expect(result.isBlocked).toBe(true)
    })
  })
})
