import { describe, expect, it } from 'vitest'

import { buildNameArbiterUserContent, parseNameArbiterItemLine } from '@/lib/services/name-arbiter'
import { normalizeCandidates } from '@/lib/services/enrich-phases/names'
import { parseGoldenUser } from '../regenerate-name-arbiter-golden-inputs'

describe('parseGoldenUser', () => {
  it('regenerate parses a golden user message via parseNameArbiterItemLine', () => {
    const item = {
      slug: 'crochet-02',
      storedName: "02 編織工作室 02's crochet",
      candidates: normalizeCandidates("02 編織工作室 02's crochet", [{ source: 'cleaned', value: '02' }]),
    }
    const user = buildNameArbiterUserContent([item])

    expect(user).toBe("請裁決以下品牌的正式名稱：\n1. [crochet-02] 儲存名稱：02 編織工作室 02's crochet / 候選：stored：02 編織工作室 02's crochet；cleaned：02")
    const parsed = parseGoldenUser(user)
    expect(parsed).toEqual({ ...item, snippets: [] })
    expect(parsed).toEqual(parseNameArbiterItemLine(user.split('\n')[1] ?? ''))
  })

  it('rejects a message without the header line, multi-item text, or an unparseable line', () => {
    expect(() => parseGoldenUser('1. [a] 儲存名稱：A / 候選：無')).toThrow()
    expect(() => parseGoldenUser('請裁決以下品牌的正式名稱：\n1. [a] 儲存名稱：A / 候選：無\n2. [b] 儲存名稱：B / 候選：無')).toThrow()
    expect(() => parseGoldenUser('請裁決以下品牌的正式名稱：\n1. [a] 儲存名稱：A')).toThrow()
    expect(() => parseGoldenUser('something else')).toThrow()
  })
})
