import { describe, expect, it } from 'vitest'
import { buildDescriptionRetryInstruction } from './description-rewrite'

const zhRejection = (reasons: string[], attempt = 1) => [
  { field: 'description_zh' as const, reasons, warnings: [], attempt },
]

describe('buildDescriptionRetryInstruction', () => {
  it('tells the model to LENGTHEN when the zh description fell under the band', () => {
    // The regression this exists for: attempt 1 came back at 125 字 and the old
    // retry made attempt 2 shorter (101 字) because it never said which bound broke.
    const instruction = buildDescriptionRetryInstruction(zhRejection(['length_band']), {
      description_zh: '短'.repeat(125),
    })
    expect(instruction).toContain('目前 125 字')
    expect(instruction).toContain('少於下限 150')
    expect(instruction).toContain('增加')
    expect(instruction).toContain('至少 25 字')
    expect(instruction).not.toContain('刪減')
  })

  it('tells the model to SHORTEN when the zh description ran over the band', () => {
    const instruction = buildDescriptionRetryInstruction(zhRejection(['length_band']), {
      description_zh: '長'.repeat(450),
    })
    expect(instruction).toContain('目前 450 字')
    expect(instruction).toContain('超過上限 400')
    expect(instruction).toContain('刪減')
    expect(instruction).toContain('至少 50 字')
    expect(instruction).not.toContain('增加')
  })

  it('uses each field\'s own band and unit', () => {
    const instruction = buildDescriptionRetryInstruction(
      [{ field: 'description_en', reasons: ['length_band'], warnings: [], attempt: 1 }],
      { description_en: 'x'.repeat(120) },
    )
    expect(instruction).toContain('120 characters')
    expect(instruction).toContain('少於下限 300')
  })

  it('falls back to naming the band when the value is unavailable', () => {
    const instruction = buildDescriptionRetryInstruction(zhRejection(['length_band']), null)
    expect(instruction).toContain('150-400')
    expect(instruction).not.toContain('目前')
  })

  it('maps non-length reasons to the edit that clears them', () => {
    const instruction = buildDescriptionRetryInstruction(
      zhRejection(['language_purity', 'pricing_information']),
      { description_zh: '內容'.repeat(100) },
    )
    expect(instruction).toContain('連續拉丁字母單詞不可超過 2 個')
    expect(instruction).toContain('移除所有售價')
  })

  it('returns no instruction when every rejection was a soft warning', () => {
    expect(
      buildDescriptionRetryInstruction(
        [{ field: 'description_en', reasons: [], warnings: ['length_band'], attempt: 1 }],
        { description_en: 'x'.repeat(120) },
      ),
    ).toBe('')
  })

  it('returns no instruction when nothing was rejected', () => {
    expect(buildDescriptionRetryInstruction([], {})).toBe('')
  })

  it('groups several reasons for the same field onto one line', () => {
    const instruction = buildDescriptionRetryInstruction(
      [
        { field: 'description_zh', reasons: ['length_band'], warnings: [], attempt: 1 },
        { field: 'blurb_zh', reasons: ['language_purity'], warnings: [], attempt: 1 },
      ],
      { description_zh: '短'.repeat(100), blurb_zh: 'all latin words here' },
    )
    const lines = instruction.split('\n').filter((line) => line.startsWith('- '))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('description_zh')
    expect(lines[1]).toContain('blurb_zh')
  })
})
