import { describe, expect, it } from 'vitest'

import { buildNameArbiterUserContent } from '@/lib/services/name-arbiter'
import { normalizeCandidates } from '@/lib/services/enrich-phases/names'
import { parseGoldenLine } from '../regenerate-name-arbiter-golden-inputs'

describe('parseGoldenLine', () => {
  it('inverts the production prompt builder for a stored-first candidate list', () => {
    const item = {
      slug: 'crochet-02',
      storedName: "02 編織工作室 02's crochet",
      candidates: normalizeCandidates("02 編織工作室 02's crochet", [{ source: 'cleaned', value: '02' }]),
    }
    const user = buildNameArbiterUserContent([item])

    expect(user).toBe("請裁決以下品牌的正式名稱：\n1. [crochet-02] 儲存名稱：02 編織工作室 02's crochet / 候選：stored：02 編織工作室 02's crochet；cleaned：02")
    expect(parseGoldenLine(user)).toEqual(item)
  })

  it('rejects multi-item or unrecognised user text', () => {
    expect(() => parseGoldenLine('請裁決以下品牌的正式名稱：\n1. [a] 儲存名稱：A / 候選：無\n2. [b] 儲存名稱：B / 候選：無')).toThrow()
    expect(() => parseGoldenLine('something else')).toThrow()
  })
})
