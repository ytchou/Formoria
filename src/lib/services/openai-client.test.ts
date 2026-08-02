import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOpenAIClient, type ChatAuditEvent, type ChatUsage } from './openai-client'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

/** Body of the nth fetch call, parsed. The client only ever sends JSON strings. */
function requestBody(spy: ReturnType<typeof vi.spyOn>, call = 0): Record<string, unknown> {
  const init = spy.mock.calls[call]?.[1] as RequestInit | undefined
  return JSON.parse(String(init?.body)) as Record<string, unknown>
}

/** Drives a chat() call to completion through the rate-limit sleeps without waiting in real time. */
async function withFakeTimers<T>(run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers()
  const promise = run()
  await vi.runAllTimersAsync()
  return promise
}

function okResponse(content = 'hi') {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }))
}

describe('createOpenAIClient', () => {
  it('fires onChatComplete with usage and latency on success', async () => {
    const usage: ChatUsage = { prompt_tokens: 21, completion_tokens: 8, total_tokens: 29 }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'hi' } }],
          usage,
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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 500 }))
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

  it('includes the provider response payload in an HTTP failure audit', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'server error' } }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const events: ChatAuditEvent[] = []
    const client = createOpenAIClient({
      apiKey: 'k',
      onChatComplete: (event) => {
        events.push(event)
      },
    })

    await client.chat({ system: 'system prompt', user: 'user prompt' })

    expect(events[0]?.data).toEqual({ error: { message: 'server error' } })
  })

  it('does not reject chat when the audit hook throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse())
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const client = createOpenAIClient({
      apiKey: 'k',
      onChatComplete: () => {
        throw new Error('audit unavailable')
      },
    })

    await expect(client.chat({ system: 'system prompt', user: 'user prompt' })).resolves.toBeDefined()
  })

  describe('request body', () => {
    it('sends max_completion_tokens and reasoning_effort for gpt-5 models, never max_tokens', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse())
      const client = createOpenAIClient({ apiKey: 'k', model: 'gpt-5.6-luna' })

      await client.chat({
        system: 's',
        user: 'u',
        maxTokens: 250,
        temperature: 0,
        reasoningEffort: 'none',
      })

      const body = requestBody(fetchSpy)
      expect(body).toMatchObject({
        model: 'gpt-5.6-luna',
        max_completion_tokens: 250,
        reasoning_effort: 'none',
        temperature: 0,
      })
      // gpt-5 rejects max_tokens outright — this is the assertion that catches the 400.
      expect(body).not.toHaveProperty('max_tokens')
    })

    // The regression that took every image classification down: the classifier
    // asks for a temperature and nothing else, so if the client does not supply
    // `reasoning_effort: 'none'` itself, gpt-5 rejects the temperature outright.
    it('turns reasoning off by itself when a gpt-5 caller asks only for a temperature', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse())
      const client = createOpenAIClient({ apiKey: 'k', model: 'gpt-5.6-luna' })

      await client.chat({ system: 's', user: 'u', maxTokens: 250, temperature: 0.1 })

      expect(requestBody(fetchSpy)).toMatchObject({
        temperature: 0.1,
        reasoning_effort: 'none',
      })
    })

    // Sampling is only live when reasoning is off, so the two cannot both apply.
    // An explicit effort wins and the temperature is dropped rather than sent,
    // because sending both is a 400 that fails the entire call.
    it('drops the temperature when a gpt-5 caller explicitly wants reasoning', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse())
      const client = createOpenAIClient({ apiKey: 'k', model: 'gpt-5.6-luna' })

      await client.chat({
        system: 's',
        user: 'u',
        temperature: 0.1,
        reasoningEffort: 'high',
      })

      const body = requestBody(fetchSpy)
      expect(body).toMatchObject({ reasoning_effort: 'high' })
      expect(body).not.toHaveProperty('temperature')
    })

    it('keeps max_tokens and omits reasoning_effort for non-gpt-5 models', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse())
      const client = createOpenAIClient({ apiKey: 'k', model: 'gpt-4o-mini' })

      await client.chat({
        system: 's',
        user: 'u',
        maxTokens: 250,
        temperature: 0,
        reasoningEffort: 'none',
      })

      const body = requestBody(fetchSpy)
      expect(body).toMatchObject({ model: 'gpt-4o-mini', max_tokens: 250, temperature: 0 })
      expect(body).not.toHaveProperty('max_completion_tokens')
      expect(body).not.toHaveProperty('reasoning_effort')
    })

    it('omits reasoning_effort when the caller does not ask for one', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse())
      const client = createOpenAIClient({ apiKey: 'k', model: 'gpt-5.6-luna' })

      await client.chat({ system: 's', user: 'u' })

      expect(requestBody(fetchSpy)).not.toHaveProperty('reasoning_effort')
    })
  })

  describe('rate limiting', () => {
    it('retries a 429 with backoff and returns the eventual success', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(null, { status: 429 }))
        .mockResolvedValueOnce(new Response(null, { status: 429 }))
        .mockResolvedValue(okResponse('recovered'))
      const client = createOpenAIClient({ apiKey: 'k' })

      const result = await withFakeTimers(() => client.chat({ system: 's', user: 'u' }))

      expect(fetchSpy).toHaveBeenCalledTimes(3)
      expect(result.ok).toBe(true)
      expect(result.content).toBe('recovered')
    })

    it('honours Retry-After before retrying', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': '2' } }))
        .mockResolvedValue(okResponse())
      const client = createOpenAIClient({ apiKey: 'k' })

      vi.useFakeTimers()
      const promise = client.chat({ system: 's', user: 'u' })
      await vi.advanceTimersByTimeAsync(1_999)
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      await promise

      expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    })

    it('gives up after the retry cap and returns the 429 to the caller', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 429 }))
      const client = createOpenAIClient({ apiKey: 'k' })

      const result = await withFakeTimers(() => client.chat({ system: 's', user: 'u' }))

      // 1 initial attempt + MAX_RATE_LIMIT_RETRIES
      expect(fetchSpy).toHaveBeenCalledTimes(6)
      expect(result.ok).toBe(false)
      expect(result.status).toBe(429)
    })
  })

  describe('structured outputs fallback', () => {
    const schema = { name: 'verdicts', schema: { type: 'object', properties: {} } }

    it('retries with json_object when the model rejects json_schema', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: { message: 'Invalid response_format', param: 'response_format' } }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          }),
        )
        .mockResolvedValue(okResponse())
      const client = createOpenAIClient({ apiKey: 'k' })

      const result = await client.chat({ system: 's', user: 'u', schema })

      expect(fetchSpy).toHaveBeenCalledTimes(2)
      expect(requestBody(fetchSpy, 0).response_format).toMatchObject({ type: 'json_schema' })
      expect(requestBody(fetchSpy, 1).response_format).toEqual({ type: 'json_object' })
      expect(result.ok).toBe(true)
    })

    it('does not retry a failure unrelated to response_format', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'context length exceeded' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      )
      const client = createOpenAIClient({ apiKey: 'k' })

      const result = await client.chat({ system: 's', user: 'u', schema })

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(result.ok).toBe(false)
    })
  })
})
