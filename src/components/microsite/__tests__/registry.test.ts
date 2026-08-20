import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { brand } from '@/lib/brand/colors'
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

/**
 * THE ONE DOCUMENTED EXCEPTION TO THE PALETTE (DESIGN.md §2).
 *
 * `--brand-accent` comes from `brands.site_content -> tokens -> accent`, a
 * jsonb path rather than a column. Those values are the BRAND's property and
 * sit deliberately outside the system palette. The design system v2 rebuild
 * repainted every other surface onto `#2F4F63`; the pull to "finish the job"
 * here is exactly what this test refuses.
 */
describe('microsite keeps its per-brand accent', () => {
  it('passes the brand value straight through, whatever it is', () => {
    for (const accent of ['#123456', '#2F5D50', '#C4693B', '#FF00FF']) {
      expect(siteTokensToCssVars({ accent })['--brand-accent']).toBe(accent)
    }
  })

  it('never substitutes the system accent', () => {
    const vars = siteTokensToCssVars({ accent: '#123456' })
    expect(vars['--brand-accent']).not.toBe(brand.accent)
  })

  it('derives the value from site_content, not from the palette', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/microsite/tokens.ts'),
      'utf8',
    )
    expect(source).toContain('tokens.accent')
    expect(source).not.toContain('@/lib/brand/colors')
    expect(source).not.toContain('#2F4F63')
  })
})
