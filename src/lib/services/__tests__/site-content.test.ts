import { describe, it, expect } from 'vitest'
import { normalizeSiteContent } from '@/lib/services/brands'

describe('normalizeSiteContent', () => {
  it('returns null for null/undefined', () => {
    expect(normalizeSiteContent(null)).toBeNull()
    expect(normalizeSiteContent(undefined)).toBeNull()
  })

  it('keeps allow-listed keys and coerces products', () => {
    const out = normalizeSiteContent({
      template: 'default',
      tokens: { accent: '#7C5C3E', accentForeground: '#FFFFFF' },
      tagline: '溫潤木作',
      story: '我們相信…',
      products: [{ name: '核桃木托盤', imageUrl: 'https://x.supabase.co/a.jpg', url: 'https://shopee.tw/x', caption: '手工' }],
      ctaType: 'mailto',
      ctaValue: 'hi@warmwood.tw',
      bogusKey: 'dropped',
    })
    expect(out).not.toBeNull()
    expect((out as Record<string, unknown>).bogusKey).toBeUndefined()
    expect(out!.tokens.accent).toBe('#7C5C3E')
    expect(out!.products).toHaveLength(1)
    expect(out!.products[0].name).toBe('核桃木托盤')
  })

  it('defaults template to "default" and tolerates missing products', () => {
    const out = normalizeSiteContent({ tagline: 't', story: 's', tokens: { accent: '#000' } })
    expect(out!.template).toBe('default')
    expect(out!.products).toEqual([])
  })
})
