const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'

const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini'

type OpenAIClientOptions = {
  apiKey?: string
  model?: string
}

type OpenAIImage = string | { url: string }

type OpenAIChatInput = {
  system: string
  user: string
  json?: boolean
  timeoutMs?: number
  maxTokens?: number
  temperature?: number
  images?: OpenAIImage[]
}

type OpenAIChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail: 'low' | 'high' | 'auto' } }

type OpenAIChatResponse = {
  choices?: Array<{ message?: { content?: string } }>
}

export type OpenAIChatResult = {
  response: Response
  data: OpenAIChatResponse | null
  content: string | null
}

export function parseJson<T>(content: string): T | null {
  try {
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

export function createOpenAIClient({ apiKey, model = DEFAULT_OPENAI_MODEL }: OpenAIClientOptions = {}) {
  const resolvedApiKey = apiKey ?? process.env.OPENAI_API_KEY

  function authHeaders(): Record<string, string> {
    if (!resolvedApiKey) {
      throw new Error('OPENAI_API_KEY is not configured')
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
    }: OpenAIChatInput): Promise<OpenAIChatResult> {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      const userContent: string | OpenAIChatContentPart[] = images?.length
        ? [
            { type: 'text', text: user },
            ...images.map((image) => ({
              type: 'image_url' as const,
              image_url: {
                url: typeof image === 'string' ? image : image.url,
                detail: 'low' as const,
              },
            })),
          ]
        : user

      try {
        const response = await fetch(OPENAI_API_URL, {
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
            ...(json ? { response_format: { type: 'json_object' } } : {}),
          }),
          signal: controller.signal,
        })

        if (!response.ok) {
          if (response.status === 429) {
            const retryAfter = response.headers.get('retry-after')
            console.error(`  [OPENAI] Rate limited (429). Retry-After: ${retryAfter ?? 'not provided'}`)
          }
          return { response, data: null, content: null }
        }

        const data = (await response.json()) as OpenAIChatResponse
        const content = data.choices?.[0]?.message?.content?.trim() ?? null

        return { response, data, content }
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}
