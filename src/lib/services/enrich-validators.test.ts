import { describe, it, expect } from 'vitest'
import { detectAiArtifacts, validateLocalizedText } from './enrich-validators'

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

describe('detectAiArtifacts — expanded ZH patterns', () => {
  it('detects AI self-disclosure', () => {
    expect(detectAiArtifacts('由於資訊有限，無法提供完整描述', 'zh').length).toBeGreaterThan(0)
    expect(detectAiArtifacts('作為一個AI，我無法確認', 'zh').length).toBeGreaterThan(0)
  })

  it('detects template placeholders', () => {
    expect(detectAiArtifacts('（此處填入品牌名稱）是台灣品牌', 'zh').length).toBeGreaterThan(0)
    expect(detectAiArtifacts('XX公司成立於2020年', 'zh').length).toBeGreaterThan(0)
  })

  it('detects collaboration residue', () => {
    expect(detectAiArtifacts('希望這對你有幫助！', 'zh').length).toBeGreaterThan(0)
    expect(detectAiArtifacts('以下是修改後的版本', 'zh').length).toBeGreaterThan(0)
  })

  it('detects 作為-style openers', () => {
    expect(detectAiArtifacts('作為台灣設計領域的重要品牌', 'zh').length).toBeGreaterThan(0)
  })

  it('detects era-hat openers', () => {
    expect(detectAiArtifacts('在當今追求永續的時代', 'zh').length).toBeGreaterThan(0)
    expect(detectAiArtifacts('隨著消費者意識的發展', 'zh').length).toBeGreaterThan(0)
  })

  it('detects generic conclusions', () => {
    expect(detectAiArtifacts('未來充滿無限可能', 'zh').length).toBeGreaterThan(0)
    expect(detectAiArtifacts('總的來說，這是好品牌', 'zh').length).toBeGreaterThan(0)
    expect(detectAiArtifacts('綜上所述', 'zh').length).toBeGreaterThan(0)
  })

  it('detects inflated significance', () => {
    expect(detectAiArtifacts('標誌著台灣工藝的新里程碑', 'zh').length).toBeGreaterThan(0)
  })

  it('detects empty analysis', () => {
    expect(detectAiArtifacts('展現了品牌對品質的堅持精神', 'zh').length).toBeGreaterThan(0)
  })

  it('detects negative parallel', () => {
    expect(detectAiArtifacts('不只是服飾品牌，更是美學詮釋者', 'zh').length).toBeGreaterThan(0)
  })

  it('detects corporate jargon (賦能/閉環)', () => {
    expect(detectAiArtifacts('賦能消費者的美學生活', 'zh').length).toBeGreaterThan(0)
    expect(detectAiArtifacts('實現從設計到銷售的閉環', 'zh').length).toBeGreaterThan(0)
  })

  it('does not flag legitimate brand text without AI patterns', () => {
    expect(detectAiArtifacts('以手工鞣製植物染皮革起家，2018年於台中開設第一間工作室', 'zh')).toEqual([])
  })

  it('keeps existing ZH and EN patterns working', () => {
    expect(detectAiArtifacts('XX是一個台灣品牌', 'zh').length).toBeGreaterThan(0)
    expect(detectAiArtifacts('XX為台灣知名品牌', 'zh').length).toBeGreaterThan(0)
    expect(detectAiArtifacts('In a world where brands compete', 'en').length).toBeGreaterThan(0)
    expect(detectAiArtifacts('This brand seamlessly combines', 'en').length).toBeGreaterThan(0)
  })
})
