import { describe, expect, it } from 'vitest'
import { parseDescriptionRewriteResult } from './description-rewrite'

describe('parseDescriptionRewriteResult', () => {
  it('returns null description when the LLM response is not valid JSON — never the raw text', () => {
    const result = parseDescriptionRewriteResult('抱歉，我無法解析，但這裡有超過二十個字元的原始輸出內容')
    expect(result.description).toBeNull()
  })
})
