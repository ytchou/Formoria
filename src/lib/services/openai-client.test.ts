import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOpenAIClient, type ChatAuditEvent } from './openai-client'

afterEach(() => vi.restoreAllMocks())

describe('createOpenAIClient', () => {
  it('fires onChatComplete with usage and latency on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'hi' } }],
          usage: { prompt_tokens: 21, completion_tokens: 8, total_tokens: 29 },
        }),
      ),
    )
    const events: ChatAuditEvent[] = []
    const client = createOpenAIClient({
      apiKey: 'k',
      onChatComplete: (event) => {
        events.push(event)
      },
    })

    await client.chat({ system: 'system prompt', user: 'user prompt' })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ provider: 'openai', ok: true, usage: { total_tokens: 29 } })
    expect(events[0]?.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('fires onChatComplete with data null on HTTP failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 429 }))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const events: ChatAuditEvent[] = []
    const client = createOpenAIClient({
      apiKey: 'k',
      onChatComplete: (event) => {
        events.push(event)
      },
    })

    await client.chat({ system: 'system prompt', user: 'user prompt' })

    expect(events[0]).toMatchObject({ provider: 'openai', ok: false, data: null })
  })

  it('does not reject chat when the audit hook throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] })),
    )
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const client = createOpenAIClient({
      apiKey: 'k',
      onChatComplete: () => {
        throw new Error('audit unavailable')
      },
    })

    await expect(client.chat({ system: 'system prompt', user: 'user prompt' })).resolves.toBeDefined()
  })
})
