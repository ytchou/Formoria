import { describe, expect, it } from 'vitest'
import { truncateForMeta } from './truncate-for-meta'

describe('truncateForMeta', () => {
  it('cuts at sentence boundary within max chars, zh and en', () => {
    const zh = '第一句話。第二句話比較長一些。第三句話讓總長超過限制。'
    expect(truncateForMeta(zh, 20)).toBe('第一句話。第二句話比較長一些。')
    expect(truncateForMeta('First sentence. Second one is longer.', 20)).toBe('First sentence.')
  })
})
