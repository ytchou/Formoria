import { describe, expect, it } from 'vitest'
import { truncateForMeta } from './truncate-for-meta'

describe('truncateForMeta', () => {
  it('cuts at sentence boundary within max chars, zh and en', () => {
    const zh = '第一句話。第二句話比較長一些。第三句話讓總長超過限制。'
    expect(truncateForMeta(zh, 20)).toBe('第一句話。第二句話比較長一些。')
    expect(truncateForMeta('First sentence. Second one is longer.', 20)).toBe('First sentence.')
  })

  it('never treats a dot inside a brand name as a sentence end (BD-08)', () => {
    const text =
      'Tan.Nichi makes hand-dyed linen goods in small batches from a studio in Tainan, ' +
      'working with local weavers and natural pigments sourced across the island for every season.'
    const result = truncateForMeta(text, 155)

    expect(result).not.toBe('Tan.')
    expect(result.startsWith('Tan.Nichi makes hand-dyed linen')).toBe(true)
    expect(result.length).toBeGreaterThan(93)
  })

  it.each([
    ['golday.jewelry', 'golday.jewelry crafts fine silver pieces by hand in Taipei for everyday wear and gifting, all year round.'],
    ['Mr.Casa', 'Mr.Casa designs solid wood furniture for compact apartments, built to last and easy to repair over many years.'],
    ['1.5cm', 'Each tile is 1.5cm thick and glazed by hand, so every batch carries small variations in colour and texture.'],
  ])('does not split on the dot in %s', (token, text) => {
    const result = truncateForMeta(text, 60)

    expect(result).toContain(token)
    expect(result.endsWith('…')).toBe(true)
    expect(result.length).toBeGreaterThan(text.indexOf(token) + token.length + 1)
  })

  it('keeps a CJK sentence boundary that falls after 60% of max', () => {
    const first = '這是一段介紹品牌理念與工藝背景的完整句子，說明他們如何挑選材料。'
    const text = `${first}第二句會讓整段描述超過長度限制而需要截斷。`

    expect(first.length).toBeGreaterThanOrEqual(Math.ceil(40 * 0.6))
    expect(truncateForMeta(text, 40)).toBe(first)
  })

  it('ignores a boundary before 60% of max and falls back to the ellipsis cut', () => {
    const text = '短句。接下來是一段很長而且沒有任何句號的描述文字會一直延續下去直到超過長度限制為止還有更多內容'
    const result = truncateForMeta(text, 30)

    expect(result).not.toBe('短句。')
    expect(result).toBe(`${text.slice(0, 30)}…`)
  })

  it('prefers a later qualifying boundary over an early one', () => {
    const text = 'Hi. This brand makes linen shirts in Tainan today. More text follows here for length.'
    expect(truncateForMeta(text, 60)).toBe('Hi. This brand makes linen shirts in Tainan today.')
  })
})
