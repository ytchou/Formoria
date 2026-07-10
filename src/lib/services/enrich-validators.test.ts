import { describe, it, expect } from 'vitest'
import { validateLocalizedText } from './enrich-validators'

describe('validateLocalizedText', () => {
  it('accepts pure zh within band', () => {
    expect(validateLocalizedText('這是'.repeat(160), 'zh', [300, 600]).ok).toBe(true)
  })
  it('rejects mixed-language text with language_purity reason', () => {
    const r = validateLocalizedText('這個品牌 sells many things ' + '好'.repeat(300), 'zh', [300, 600])
    expect(r.ok).toBe(false)
    expect(r.reasons).toContain('language_purity')
  })

  it('rejects zh text outside length band', () => {
    const r = validateLocalizedText('太短', 'zh', [300, 600])
    expect(r.ok).toBe(false)
    expect(r.reasons).toContain('length_band')
  })

  it('warns but accepts en text outside length band', () => {
    const r = validateLocalizedText('short', 'en', [300, 600])
    expect(r.ok).toBe(true)
    expect(r.warnings).toContain('length_band')
  })
})
