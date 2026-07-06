import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDeepSeekClient, parseDeepSeekJson } from './deepseek-client'

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
})

describe('parseDeepSeekJson', () => {
  it('returns parsed object for valid JSON content', () => {
    expect(parseDeepSeekJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 })
  })

  it('returns null (never raw text) for unparseable content', () => {
    expect(parseDeepSeekJson('sorry, here is your description: 這是一段長文...')).toBeNull()
  })
})
