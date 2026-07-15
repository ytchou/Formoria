import { beforeEach, describe, expect, it, vi } from 'vitest'
import { insertAiCallResult } from '@/lib/services/ai-results'
import { createAuditedDeepSeekClient } from '@/lib/services/llm-audit'

const mocks = vi.hoisted(() => ({
  createDeepSeekClient: vi.fn(),
}))

vi.mock('@/lib/services/ai-results', () => ({ insertAiCallResult: vi.fn() }))
vi.mock('@/lib/services/deepseek-client', () => ({ createDeepSeekClient: mocks.createDeepSeekClient }))

describe('createAuditedDeepSeekClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(insertAiCallResult).mockResolvedValue(undefined)
    mocks.createDeepSeekClient.mockImplementation((options) => ({
      chat: async (request: { system: string; user: string }) => {
        await options.onChatComplete({
          provider: 'deepseek',
          model: 'deepseek-v4-flash',
          ok: true,
          status: 200,
          data: {
            choices: [{ message: { content: '{"isBrand":true}' } }],
            usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
          },
          usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
          latencyMs: 320,
          request: { ...request, imageCount: 0 },
        })
        return { content: '{"isBrand":true}' }
      },
    }))
  })

  it('persists one audit row with job and phase context', async () => {
    const client = createAuditedDeepSeekClient({
      jobId: '0b8b1f48-2788-4a97-b68e-83c4b4a32c76',
      target: { type: 'brand', id: '27136a0d-e7e6-4c39-a524-21c8cd726eab' },
      phase: 'detect',
    })

    await client.chat({ system: 'Classify this company.', user: 'Acme Taiwan' })

    expect(insertAiCallResult).toHaveBeenCalledOnce()
    expect(insertAiCallResult).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: '0b8b1f48-2788-4a97-b68e-83c4b4a32c76',
        phase: 'detect',
        model: 'deepseek-v4-flash',
        latencyMs: 320,
      }),
    )
  })

  it('does not reject chat when audit persistence fails', async () => {
    vi.mocked(insertAiCallResult).mockRejectedValueOnce(new Error('database unavailable'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const client = createAuditedDeepSeekClient({
      target: { type: 'submission', id: '74191492-f289-4ca1-a35c-3d4c2d779d60' },
      phase: 'detect',
    })

    await expect(client.chat({ system: 'Classify this company.', user: 'Island Tools' })).resolves.toBeDefined()
  })
})
