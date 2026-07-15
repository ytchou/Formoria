import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDeepSeekClient, parseDeepSeekJson, type ChatAuditEvent } from './deepseek-client'

afterEach(() => vi.restoreAllMocks())

describe('createDeepSeekClient', () => {
  it('POSTs chat messages to the single base URL with auth + timeout', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })),
    )
    const client = createDeepSeekClient({ apiKey: 'k' })
    await client.chat({ system: 'sys', user: 'hi', json: true, timeoutMs: 5000 })
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(String(url)).toBe('https://api.deepseek.com/chat/completions')
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer k')
    expect(init!.signal).toBeInstanceOf(AbortSignal)
  })

  it('fires onChatComplete with usage and latency on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'hi' } }],
          usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
        }),
      ),
    )
    const events: ChatAuditEvent[] = []
    const client = createDeepSeekClient({
      apiKey: 'k',
      onChatComplete: (event) => {
        events.push(event)
      },
    })

    await client.chat({ system: 'system prompt', user: 'user prompt' })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ provider: 'deepseek', ok: true, usage: { total_tokens: 17 } })
    expect(events[0]?.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('fires onChatComplete with data null on HTTP failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 429 }))
    const events: ChatAuditEvent[] = []
    const client = createDeepSeekClient({
      apiKey: 'k',
      onChatComplete: (event) => {
        events.push(event)
      },
    })

    await client.chat({ system: 'system prompt', user: 'user prompt' })

    expect(events[0]).toMatchObject({ provider: 'deepseek', ok: false, data: null })
  })

  it('includes the provider response payload in an HTTP failure audit', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'rate limit exceeded' } }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const events: ChatAuditEvent[] = []
    const client = createDeepSeekClient({
      apiKey: 'k',
      onChatComplete: (event) => {
        events.push(event)
      },
    })

    await client.chat({ system: 'system prompt', user: 'user prompt' })

    expect(events[0]?.data).toEqual({ error: { message: 'rate limit exceeded' } })
  })

  it('does not reject chat when the audit hook throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] })),
    )
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const client = createDeepSeekClient({
      apiKey: 'k',
      onChatComplete: () => {
        throw new Error('audit unavailable')
      },
    })

    await expect(client.chat({ system: 'system prompt', user: 'user prompt' })).resolves.toBeDefined()
  })
})

describe('parseDeepSeekJson', () => {
  it('returns parsed object for valid JSON content', () => {
    expect(parseDeepSeekJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 })
  })

  it('returns null (never raw text) for unparseable content', () => {
    expect(parseDeepSeekJson('sorry, here is your description: 這是一段長文...')).toBeNull()
  })
})
