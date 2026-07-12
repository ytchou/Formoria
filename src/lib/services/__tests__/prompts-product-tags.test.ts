import { describe, it, expect } from 'vitest'
import { DESCRIPTION_SYSTEM_PROMPT } from '@/lib/prompts'

describe('DESCRIPTION_SYSTEM_PROMPT product_tags vocabulary', () => {
  it('embeds the subcategory tree grouped by L1 category', () => {
    expect(DESCRIPTION_SYSTEM_PROMPT).toContain('包袋配件')
    expect(DESCRIPTION_SYSTEM_PROMPT).toContain('口金包')
    expect(DESCRIPTION_SYSTEM_PROMPT).toContain('托特包')
    expect(DESCRIPTION_SYSTEM_PROMPT).toContain('手工皂')
  })
  it('instructs two-step extraction and vocabulary preference', () => {
    expect(DESCRIPTION_SYSTEM_PROMPT).toMatch(/先.*產品線|先列出/)
    expect(DESCRIPTION_SYSTEM_PROMPT).toMatch(/優先.*詞彙表|從.*詞彙表.*選/)
  })
  it('no longer forbids broad categories (old instruction removed)', () => {
    expect(DESCRIPTION_SYSTEM_PROMPT).not.toContain('不要用寬泛分類')
  })
})
