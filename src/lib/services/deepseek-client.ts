const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions'
const DEEPSEEK_BALANCE_API_URL = 'https://api.deepseek.com/user/balance'

const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash'

type DeepSeekClientOptions = {
  apiKey?: string
  model?: string
  onChatComplete?: (event: ChatAuditEvent) => void | Promise<void>
}

type DeepSeekImage = string | { url: string }

type DeepSeekChatInput = {
  system: string
  user: string
  json?: boolean
  timeoutMs?: number
  maxTokens?: number
  temperature?: number
  images?: DeepSeekImage[]
  meta?: Record<string, unknown>
}

type DeepSeekChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type DeepSeekChatResponse = {
  choices?: Array<{ message?: { content?: string } }>
  usage?: ChatUsage
}

export type ChatUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

export type ChatAuditEvent = {
  provider: 'deepseek'
  model: string
  ok: boolean
  status: number
  data: DeepSeekChatResponse | null
  usage?: ChatUsage
  latencyMs: number
  request: {
    system: string
    user: string
    imageCount: number
  }
  meta?: Record<string, unknown>
  error?: string
}

export type DeepSeekChatResult = {
  response: Response
  data: DeepSeekChatResponse | null
  content: string | null
}

export function parseDeepSeekJson<T>(content: string): T | null {
  try {
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

export function createDeepSeekClient({
  apiKey,
  model = DEFAULT_DEEPSEEK_MODEL,
  onChatComplete,
}: DeepSeekClientOptions = {}) {
  const resolvedApiKey = apiKey ?? process.env.DEEPSEEK_API_KEY

  async function emitAudit(event: ChatAuditEvent): Promise<void> {
    if (!onChatComplete) return

    try {
      await onChatComplete(event)
    } catch (error) {
      console.error('[deepseek-client:audit]', { error: error instanceof Error ? error.message : String(error) })
    }
  }

  function authHeaders(): Record<string, string> {
    if (!resolvedApiKey) {
      throw new Error('DEEPSEEK_API_KEY is not configured')
    }

    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${resolvedApiKey}`,
    }
  }

  return {
    async chat({
      system,
      user,
      json = false,
      timeoutMs = 30_000,
      maxTokens,
      temperature,
      images,
      meta,
    }: DeepSeekChatInput): Promise<DeepSeekChatResult> {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      const startedAt = performance.now()
      const userContent: string | DeepSeekChatContentPart[] = images?.length
        ? [
            { type: 'text', text: user },
            ...images.map((image) => ({
              type: 'image_url' as const,
              image_url: { url: typeof image === 'string' ? image : image.url },
            })),
          ]
        : user

      try {
        const response = await fetch(DEEPSEEK_API_URL, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: userContent },
            ],
            ...(typeof maxTokens === 'number' ? { max_tokens: maxTokens } : {}),
            ...(typeof temperature === 'number' ? { temperature } : {}),
            thinking: { type: 'disabled' },
            ...(json ? { response_format: { type: 'json_object' } } : {}),
          }),
          signal: controller.signal,
        })

        if (!response.ok) {
          await emitAudit({
            provider: 'deepseek',
            model,
            ok: false,
            status: response.status,
            data: null,
            latencyMs: performance.now() - startedAt,
            request: { system, user, imageCount: images?.length ?? 0 },
            ...(meta ? { meta } : {}),
          })
          return { response, data: null, content: null }
        }

        const data = await response.json() as DeepSeekChatResponse
        const content = data.choices?.[0]?.message?.content?.trim() ?? null

        await emitAudit({
          provider: 'deepseek',
          model,
          ok: true,
          status: response.status,
          data,
          ...(data.usage ? { usage: data.usage } : {}),
          latencyMs: performance.now() - startedAt,
          request: { system, user, imageCount: images?.length ?? 0 },
          ...(meta ? { meta } : {}),
        })

        return { response, data, content }
      } catch (error) {
        await emitAudit({
          provider: 'deepseek',
          model,
          ok: false,
          status: 0,
          data: null,
          latencyMs: performance.now() - startedAt,
          request: { system, user, imageCount: images?.length ?? 0 },
          ...(meta ? { meta } : {}),
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      } finally {
        clearTimeout(timeout)
      }
    },

    async balance(timeoutMs = 3000): Promise<Response> {
      return fetch(DEEPSEEK_BALANCE_API_URL, {
        headers: authHeaders(),
        signal: AbortSignal.timeout(timeoutMs),
      })
    },
  }
}
