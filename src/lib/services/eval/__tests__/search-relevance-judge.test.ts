import { describe, expect, it, vi } from 'vitest'
import { judgeRelevance } from '../search-relevance-judge'

const QUERY = '送給剛搬新家的朋友'

const product = {
  name_zh: '手作陶瓷香氛蠟燭',
  name_en: 'Handmade Ceramic Scented Candle',
  category_zh: '居家生活',
  subcategory_zh: '香氛蠟燭',
  materials_zh: '大豆蠟、陶瓷',
  description_zh: '鶯歌陶藝師手拉坯的杯型容器，點完蠟燭可以當小花器或筆筒使用。',
}

function grade(value: number, reason = '陶瓷容器能延續使用，適合當作入厝禮物。') {
  return { content: JSON.stringify({ grade: value, reason }) }
}

describe('judgeRelevance', () => {
  it('returns the majority grade and a unanimous flag', async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce(grade(2))
      .mockResolvedValueOnce(grade(2))
      .mockResolvedValueOnce(grade(3, '香氛蠟燭是常見的入厝禮，直接符合情境。'))

    const result = await judgeRelevance(
      { query: QUERY, product },
      { chat, samples: 3 },
    )

    expect(result.grade).toBe(2)
    expect(result.votes).toEqual([2, 2, 3])
    expect(result.unanimous).toBe(false)
    expect(result.split).toBe(false)
  })

  it('flags a three-way split for human review', async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce(grade(1, '蠟燭與搬家的關聯較弱。'))
      .mockResolvedValueOnce(grade(2))
      .mockResolvedValueOnce(grade(3, '香氛蠟燭是常見的入厝禮，直接符合情境。'))

    const result = await judgeRelevance(
      { query: QUERY, product },
      { chat, samples: 3 },
    )

    expect(result.split).toBe(true)
    expect(result.grade).toBe(2) // median
  })

  it('tolerates one malformed sample', async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce({ content: '{bad' })
      .mockResolvedValueOnce(grade(3))
      .mockResolvedValueOnce(grade(3))

    const result = await judgeRelevance(
      { query: QUERY, product },
      { chat, samples: 3 },
    )

    expect(result.grade).toBe(3)
    expect(result.votes).toEqual([3, 3])

    // All malformed
    const chatBad = vi.fn().mockResolvedValue({ content: '{bad' })
    const result2 = await judgeRelevance(
      { query: QUERY, product },
      { chat: chatBad, samples: 3 },
    )
    expect(result2.grade).toBeNull()
    expect(result2.votes).toEqual([])
  })

  it('calls chat with the pinned prompt and product variables', async () => {
    const chat = vi.fn().mockResolvedValue(grade(2))
    const fetchPrompt = vi.fn().mockResolvedValue({
      text: 'custom system prompt',
      prompt: { name: 'search-relevance-judge', version: 1, source: 'snapshot' as const },
    })

    await judgeRelevance(
      { query: QUERY, product },
      { chat, fetchPrompt, samples: 1 },
    )

    expect(fetchPrompt).toHaveBeenCalledWith('search-relevance-judge')
    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'custom system prompt',
        user: expect.stringContaining(QUERY),
        schema: expect.objectContaining({ name: 'relevance_grade' }),
      }),
    )
    expect('json' in chat.mock.calls[0]![0]).toBe(false)
    expect(chat.mock.calls[0]![0].user).toContain('name_zh: 手作陶瓷香氛蠟燭')
  })

  it('sends a strict schema constraining grade to 0-3', async () => {
    const chat = vi.fn().mockResolvedValue(grade(2))

    await judgeRelevance({ query: QUERY, product }, { chat, samples: 1 })

    const schema = chat.mock.calls[0]![0].schema.schema
    expect(schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['grade', 'reason'],
      properties: {
        grade: { type: 'integer', minimum: 0, maximum: 3 },
        reason: { type: 'string' },
      },
    })
    expect(schema.$schema).toBeUndefined()
  })

  it('drops out-of-range and non-integer grades', async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce(grade(4))
      .mockResolvedValueOnce(grade(1.5))
      .mockResolvedValueOnce(grade(1, '蠟燭與搬家的關聯較弱。'))

    const result = await judgeRelevance({ query: QUERY, product }, { chat, samples: 3 })

    expect(result.votes).toEqual([1])
  })

  it('runs samples concurrently and skips a rejected call', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const track = async <T,>(settle: () => T): Promise<T> => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 0))
      inFlight--
      return settle()
    }
    const chat = vi.fn(() => track(() => grade(2)))
    chat.mockImplementationOnce(() =>
      track(() => {
        throw new Error('OpenAI 500: upstream timeout')
      }),
    )

    const result = await judgeRelevance({ query: QUERY, product }, { chat, samples: 3 })

    expect(maxInFlight).toBe(3)
    expect(result.votes).toEqual([2, 2])
    expect(result.grade).toBe(2)
  })

  describe('with deps.decide (Jev)', () => {
    function jevResult(score: number) {
      return {
        answers: {
          grade: { score, probabilities: { '0': 0.05, '1': 0.1, '2': 0.6, '3': 0.25 } },
        },
        usage: { input_tokens: 120, output_tokens: 4 },
        latencyMs: 42,
        costUsd: 0.0001,
      }
    }

    it('makes one decide call and no chat call', async () => {
      const chat = vi.fn()
      const fetchPrompt = vi.fn()
      const decide = vi.fn().mockResolvedValue(jevResult(2.05))

      const result = await judgeRelevance(
        { query: QUERY, product },
        { chat, fetchPrompt, decide, samples: 3 },
      )

      expect(decide).toHaveBeenCalledTimes(1)
      expect(decide.mock.calls[0]![0]).toBe('search_relevance_judge')
      expect(decide.mock.calls[0]![1]).toMatchObject({ query: QUERY })
      expect(chat).not.toHaveBeenCalled()
      expect(fetchPrompt).not.toHaveBeenCalled()

      expect(Number.isInteger(result.grade)).toBe(true)
      expect(result.grade).toBeGreaterThanOrEqual(0)
      expect(result.grade).toBeLessThanOrEqual(3)
      expect(result.grade).toBe(2)
      expect(result.votes).toEqual([2])
      expect(result.votes.every(Number.isInteger)).toBe(true)
      expect(result.unanimous).toBe(true)
      expect(result.split).toBe(false)
      expect(result.probabilities).toEqual({ '0': 0.05, '1': 0.1, '2': 0.6, '3': 0.25 })
    })

    it('returns a null grade with no votes when the score is missing', async () => {
      const decide = vi.fn().mockResolvedValue({ ...jevResult(0), answers: {} })

      const result = await judgeRelevance({ query: QUERY, product }, { decide })

      expect(result.grade).toBeNull()
      expect(result.votes).toEqual([])
    })
  })
})
