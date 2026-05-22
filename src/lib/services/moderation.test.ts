import { describe, it, expect } from 'vitest'
import { checkContent } from './moderation'

// --- New Tier 1 pattern tests ---

describe('new Tier 1 patterns', () => {
  it('blocks SEO spam — "buy now"', () => {
    const result = checkContent({ description: 'buy now at our store' })
    expect(result.isBlocked).toBe(true)
    expect(result.blocked[0].field).toBe('description')
  })

  it('blocks SEO spam — "order today"', () => {
    const result = checkContent({ description: 'order today and save big' })
    expect(result.isBlocked).toBe(true)
  })

  it('blocks MLM language', () => {
    const result = checkContent({ description: 'join our downline and earn passive income' })
    expect(result.isBlocked).toBe(true)
  })

  it('blocks fake testimonials', () => {
    const result = checkContent({ description: 'guaranteed results or your money back' })
    expect(result.isBlocked).toBe(true)
  })

  it('blocks health fraud', () => {
    const result = checkContent({ name: 'Miracle Cure Tea' })
    expect(result.isBlocked).toBe(true)
  })

  it('blocks phishing language', () => {
    const result = checkContent({ description: 'click here to claim your prize' })
    expect(result.isBlocked).toBe(true)
  })

  it('does not block legitimate Taiwanese brand content', () => {
    const result = checkContent({
      name: 'Sunrise Ceramics',
      description: 'Hand-thrown pottery from Yingge, crafted since 1980. Buy online or visit our studio.',
    })
    // "Buy online" is not the same as "buy now" — should NOT block
    expect(result.isBlocked).toBe(false)
  })
})

// --- New Tier 2 heuristic tests ---

describe('new Tier 2 heuristics', () => {
  it('flags duplicate name and description', () => {
    const result = checkContent({ name: 'Sun Tea', description: 'Sun Tea' })
    expect(result.flagged.some(f => f.field === 'description' && f.reason.includes('duplicate'))).toBe(true)
  })

  it('flags very short description', () => {
    const result = checkContent({ description: 'Good tea' })
    expect(result.flagged.some(f => f.field === 'description' && f.reason.includes('short'))).toBe(true)
  })

  it('does not flag description at or above 20 chars', () => {
    const result = checkContent({ description: 'Quality leather goods.' }) // 22 chars
    expect(result.flagged.some(f => f.field === 'description')).toBe(false)
  })

  it('flags excessive emoji', () => {
    const result = checkContent({ description: '🌟✨🎉🔥💎🌈🎊🍀🌺🏆💫 amazing brand' })
    expect(result.flagged.some(f => f.field === 'description' && f.reason.includes('emoji'))).toBe(true)
  })

  it('flags suspicious TLD in websiteUrl', () => {
    const result = checkContent({ websiteUrl: 'https://brandname.tk' })
    expect(result.flagged.some(f => f.field === 'websiteUrl' && f.reason.includes('TLD'))).toBe(true)
  })

  it('does not flag legitimate .com URL', () => {
    const result = checkContent({ websiteUrl: 'https://brandname.com' })
    expect(result.flagged.some(f => f.field === 'websiteUrl')).toBe(false)
  })
})

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
