import { describe, expect, it, vi } from 'vitest'
import { judgeRelevance } from '../search-relevance-judge'

const product = {
  name_zh: 'Test Product',
  name_en: 'Test Product EN',
  category_zh: 'home',
  subcategory_zh: 'tea',
  materials_zh: 'ceramic',
  description_zh: 'A nice product',
}

describe('judgeRelevance', () => {
  it('returns the majority grade and a unanimous flag', async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce({ content: '{"grade": 2, "reason": "ok"}' })
      .mockResolvedValueOnce({ content: '{"grade": 2, "reason": "ok"}' })
      .mockResolvedValueOnce({ content: '{"grade": 3, "reason": "good"}' })

    const result = await judgeRelevance(
      { query: 'tea gift', product },
      { chat, samples: 3 },
    )

    expect(result.grade).toBe(2)
    expect(result.votes).toEqual([2, 2, 3])
    expect(result.unanimous).toBe(false)
    expect(result.split).toBe(false)
  })

  it('flags a three-way split for human review', async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce({ content: '{"grade": 1, "reason": "a"}' })
      .mockResolvedValueOnce({ content: '{"grade": 2, "reason": "b"}' })
      .mockResolvedValueOnce({ content: '{"grade": 3, "reason": "c"}' })

    const result = await judgeRelevance(
      { query: 'q', product },
      { chat, samples: 3 },
    )

    expect(result.split).toBe(true)
    expect(result.grade).toBe(2) // median
  })

  it('tolerates one malformed sample', async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce({ content: '{bad' })
      .mockResolvedValueOnce({ content: '{"grade": 3, "reason": "ok"}' })
      .mockResolvedValueOnce({ content: '{"grade": 3, "reason": "ok"}' })

    const result = await judgeRelevance(
      { query: 'q', product },
      { chat, samples: 3 },
    )

    expect(result.grade).toBe(3)
    expect(result.votes).toEqual([3, 3])

    // All malformed
    const chatBad = vi.fn().mockResolvedValue({ content: '{bad' })
    const result2 = await judgeRelevance(
      { query: 'q', product },
      { chat: chatBad, samples: 3 },
    )
    expect(result2.grade).toBeNull()
    expect(result2.votes).toEqual([])
  })

  it('calls chat with the pinned prompt and product variables', async () => {
    const chat = vi.fn().mockResolvedValue({ content: '{"grade": 2, "reason": "ok"}' })
    const fetchPrompt = vi.fn().mockResolvedValue({
      text: 'custom system prompt',
      prompt: { name: 'search-relevance-judge', version: 1, source: 'snapshot' as const },
    })

    await judgeRelevance(
      { query: 'test query', product },
      { chat, fetchPrompt, samples: 1 },
    )

    expect(fetchPrompt).toHaveBeenCalledWith('search-relevance-judge')
    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'custom system prompt',
        user: expect.stringContaining('test query'),
        json: true,
      }),
    )
    expect(chat.mock.calls[0]![0].user).toContain('name_zh: Test Product')
  })
})
