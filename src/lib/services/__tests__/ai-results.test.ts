import { beforeEach, describe, expect, it, vi } from 'vitest'
import { insertAiCallResult } from '@/lib/services/ai-results'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  insert: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({ from: mocks.from }),
}))

describe('insertAiCallResult', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.from.mockReturnValue({ insert: mocks.insert })
    mocks.insert.mockResolvedValue({ error: null })
  })

  it('rounds fractional latency for the integer audit column', async () => {
    await insertAiCallResult({
      target: { type: 'brand', id: '27136a0d-e7e6-4c39-a524-21c8cd726eab' },
      jobId: '0b8b1f48-2788-4a97-b68e-83c4b4a32c76',
      phase: 'classify_images',
      model: 'gpt-4o-mini',
      rawResponse: { usage: { total_tokens: 42 } },
      input: { imageCount: 1 },
      latencyMs: 4677.269872999983,
    })

    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ latency_ms: 4677 }),
    )
  })
})
