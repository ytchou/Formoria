import { describe, it, expect } from 'vitest'
import { scanContent } from './moderation'

const cleanPayload = {
  fields: {
    name: '臺灣手工皂',
    description: '這是一個專注於天然原料的手工皂品牌，所有產品均在台灣製造。',
    brandHighlights: '100% 天然成分，無化學添加物。',
    website: 'https://example.com',
  },
  brandName: '臺灣手工皂',
}

describe('scanContent — Tier 1 hard blocks', () => {
  it('returns clean for a normal zh-TW brand', () => {
    const result = scanContent(cleanPayload)
    expect(result.riskLevel).toBe('clean')
    expect(result.flags).toHaveLength(0)
  })

  it('flags suspicious TLD (.tk) in URL field', () => {
    const result = scanContent({
      ...cleanPayload,
      fields: { ...cleanPayload.fields, website: 'https://spamsite.tk' },
    })
    expect(result.riskLevel).toBe('high')
    expect(result.flags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tier: 'tier1', fieldName: 'website' }),
      ])
    )
  })

  it('flags .ml TLD in purchase link URL', () => {
    const result = scanContent({
      ...cleanPayload,
      fields: { ...cleanPayload.fields, purchaseUrl: 'https://buy.ml/product' },
    })
    expect(result.flags.some(f => f.tier === 'tier1')).toBe(true)
  })

  it('flags excessive URLs in description (>3 links)', () => {
    const desc = 'Visit https://a.com and https://b.com and https://c.com and https://d.com for deals'
    const result = scanContent({
      ...cleanPayload,
      fields: { ...cleanPayload.fields, description: desc },
    })
    expect(result.riskLevel).toBe('high')
    expect(result.flags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tier: 'tier1', fieldName: 'description' }),
      ])
    )
  })

  it('flags English spam phrase in name field', () => {
    const result = scanContent({
      ...cleanPayload,
      fields: { ...cleanPayload.fields, name: 'Click here to buy now free' },
      brandName: 'Click here to buy now free',
    })
    expect(result.flags.some(f => f.tier === 'tier1' && f.fieldName === 'name')).toBe(true)
  })
})

describe('scanContent — Tier 2 zh-TW flagging', () => {
  it('flags phone number injection in description', () => {
    const result = scanContent({
      ...cleanPayload,
      fields: { ...cleanPayload.fields, description: '請撥打 0912-345-678 聯繫我們，天然手工皂品牌。' },
    })
    expect(result.riskLevel).toBe('medium')
    expect(result.flags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tier: 'tier2', fieldName: 'description' }),
      ])
    )
  })

  it('flags email injection in brandHighlights', () => {
    const result = scanContent({
      ...cleanPayload,
      fields: { ...cleanPayload.fields, brandHighlights: '聯繫我們：contact@spam.com 獲得優惠。' },
    })
    expect(result.flags.some(f => f.tier === 'tier2' && f.fieldName === 'brandHighlights')).toBe(true)
  })

  it('flags excessive emoji (>10) in any field', () => {
    const result = scanContent({
      ...cleanPayload,
      fields: { ...cleanPayload.fields, description: '🌟✨💫🎉🎊🌸🌺🌻🌹🌷🌼 手工皂品牌' },
    })
    expect(result.flags.some(f => f.tier === 'tier2')).toBe(true)
  })

  it('flags description shorter than 10 CJK characters', () => {
    const result = scanContent({
      ...cleanPayload,
      fields: { ...cleanPayload.fields, description: '好皂' },
    })
    expect(result.flags.some(f => f.tier === 'tier2' && f.fieldName === 'description')).toBe(true)
  })

  it('flags description identical to brand name', () => {
    const result = scanContent({
      ...cleanPayload,
      fields: { ...cleanPayload.fields, description: '臺灣手工皂' },
    })
    expect(result.flags.some(f => f.tier === 'tier2')).toBe(true)
  })
})

describe('scanContent — risk level calculation', () => {
  it('returns high for tier-1 flags', () => {
    const result = scanContent({
      ...cleanPayload,
      fields: { ...cleanPayload.fields, website: 'https://evil.tk' },
    })
    expect(result.riskLevel).toBe('high')
  })

  it('returns medium for tier-2 flags only', () => {
    const result = scanContent({
      ...cleanPayload,
      fields: { ...cleanPayload.fields, description: '好' },
    })
    expect(result.riskLevel).toBe('medium')
  })

  it('returns clean when no flags', () => {
    expect(scanContent(cleanPayload).riskLevel).toBe('clean')
  })

  it('returns high when both tier-1 and tier-2 flags exist', () => {
    const result = scanContent({
      ...cleanPayload,
      fields: {
        ...cleanPayload.fields,
        website: 'https://evil.tk',
        description: '好',
      },
    })
    expect(result.riskLevel).toBe('high')
  })
})
