import { describe, it, expect } from 'vitest'
import { siteTokensToCssVars } from '@/components/microsite/tokens'
import { getTemplate } from '@/components/microsite/templates/registry'
import { DefaultTemplate } from '@/components/microsite/templates/default-template'

describe('swappable design system', () => {
  it('maps tokens to CSS custom properties (data-driven, arbitrary accent)', () => {
    const vars = siteTokensToCssVars({ accent: '#123456', accentForeground: '#FFFFFF' })
    expect(vars['--brand-accent']).toBe('#123456')
    expect(vars['--brand-accent-foreground']).toBe('#FFFFFF')
  })

  it('defaults accentForeground when omitted', () => {
    const vars = siteTokensToCssVars({ accent: '#000000' })
    expect(vars['--brand-accent']).toBe('#000000')
    expect(vars['--brand-accent-foreground']).toBeDefined()
  })

  it('resolves the default template and falls back for unknown ids', () => {
    expect(getTemplate('default')).toBe(DefaultTemplate)
    expect(getTemplate('nope')).toBe(DefaultTemplate)
    expect(getTemplate(undefined)).toBe(DefaultTemplate)
  })
})
