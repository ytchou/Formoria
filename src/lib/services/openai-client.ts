const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'

const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini'

type OpenAIClientOptions = {
  apiKey?: string
  model?: string
  onChatComplete?: (event: ChatAuditEvent) => void | Promise<void>
}

type OpenAIImage = string | { url: string }

type OpenAIJsonSchema = {
  name: string
  schema: Record<string, unknown>
}

type OpenAIChatInput = {
  system: string
  user: string
  json?: boolean
  timeoutMs?: number
  maxTokens?: number
  temperature?: number
  images?: OpenAIImage[]
  /** `low` caps every image at 512px; `high` tiles it. Defaults to `low` for cost. */
  imageDetail?: 'low' | 'high' | 'auto'
  meta?: Record<string, unknown>
  schema?: OpenAIJsonSchema
}

type OpenAIChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail: 'low' | 'high' | 'auto' } }

type OpenAIChatResponse = {
  choices?: Array<{
    message?: { content?: string; refusal?: string | null }
    finish_reason?: string | null
  }>
  usage?: ChatUsage
}

export type ChatUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

export type ChatAuditEvent = {
  provider: 'openai'
  model: string
  ok: boolean
  status: number
  data: unknown
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

export type OpenAIChatResult = {
  response: Response
  data: OpenAIChatResponse | null
  content: string | null
  ok: boolean
  status: number
  errorBody: unknown
  finishReason: string | null
  refusal: string | null
}

export function parseJson<T>(content: string): T | null {
  try {
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

// Latched so a model snapshot without Structured Outputs warns once per process, not per batch.
let warnedStructuredOutputsUnsupported = false

function mentionsResponseFormat(errorBody: unknown): boolean {
  if (!errorBody || typeof errorBody !== 'object') return false
  const { error } = errorBody as { error?: unknown }
  if (!error || typeof error !== 'object') return false
  const { message, param } = error as { message?: unknown; param?: unknown }
  const haystack = [typeof message === 'string' ? message : '', typeof param === 'string' ? param : ''].join(' ')
  return haystack.includes('response_format') || haystack.includes('json_schema')
}

function networkFailureResponse(): Response {
  return new Response(null, { status: 503, statusText: 'openai request failed' })
}

export function createOpenAIClient({ apiKey, model = DEFAULT_OPENAI_MODEL, onChatComplete }: OpenAIClientOptions = {}) {
  const resolvedApiKey = apiKey ?? process.env.OPENAI_API_KEY

  async function emitAudit(event: ChatAuditEvent): Promise<void> {
    if (!onChatComplete) return

    try {
      await onChatComplete(event)
    } catch (error) {
      console.error('[openai-client:audit]', { error: error instanceof Error ? error.message : String(error) })
    }
  }

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
      imageDetail = 'low',
      meta,
      schema,
    }: OpenAIChatInput): Promise<OpenAIChatResult> {
      // Resolved up front so a missing API key still throws instead of being swallowed as a failed attempt.
      const headers = authHeaders()
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      const userContent: string | OpenAIChatContentPart[] = images?.length
        ? [
            { type: 'text', text: user },
            ...images.map((image) => ({
              type: 'image_url' as const,
              image_url: {
                url: typeof image === 'string' ? image : image.url,
                detail: imageDetail,
              },
            })),
          ]
        : user

      function responseFormat(useSchema: boolean): Record<string, unknown> {
        if (useSchema && schema) {
          return {
            response_format: {
              type: 'json_schema',
              json_schema: { name: schema.name, strict: true, schema: schema.schema },
            },
          }
        }
        return json || schema ? { response_format: { type: 'json_object' } } : {}
      }

      async function attempt(useSchema: boolean): Promise<OpenAIChatResult> {
        const startedAt = performance.now()

        try {
          const response = await fetch(OPENAI_API_URL, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model,
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: userContent },
              ],
              ...(typeof maxTokens === 'number' ? { max_tokens: maxTokens } : {}),
              ...(typeof temperature === 'number' ? { temperature } : {}),
              ...responseFormat(useSchema),
            }),
            signal: controller.signal,
          })

          if (!response.ok) {
            if (response.status === 429) {
              const retryAfter = response.headers.get('retry-after')
              console.error(`  [OPENAI] Rate limited (429). Retry-After: ${retryAfter ?? 'not provided'}`)
            }
            const data = (await response.clone().json().catch(() => null)) as unknown
            await emitAudit({
              provider: 'openai',
              model,
              ok: false,
              status: response.status,
              data,
              latencyMs: performance.now() - startedAt,
              request: { system, user, imageCount: images?.length ?? 0 },
              ...(meta ? { meta } : {}),
            })
            return {
              response,
              data: null,
              content: null,
              ok: false,
              status: response.status,
              errorBody: data,
              finishReason: null,
              refusal: null,
            }
          }

          const data = (await response.json()) as OpenAIChatResponse
          const content = data.choices?.[0]?.message?.content?.trim() ?? null

          await emitAudit({
            provider: 'openai',
            model,
            ok: true,
            status: response.status,
            data,
            ...(data.usage ? { usage: data.usage } : {}),
            latencyMs: performance.now() - startedAt,
            request: { system, user, imageCount: images?.length ?? 0 },
            ...(meta ? { meta } : {}),
          })

          return {
            response,
            data,
            content,
            ok: true,
            status: response.status,
            errorBody: null,
            finishReason: data.choices?.[0]?.finish_reason ?? null,
            refusal: data.choices?.[0]?.message?.refusal ?? null,
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          await emitAudit({
            provider: 'openai',
            model,
            ok: false,
            status: 0,
            data: null,
            latencyMs: performance.now() - startedAt,
            request: { system, user, imageCount: images?.length ?? 0 },
            ...(meta ? { meta } : {}),
            error: message,
          })
          return {
            response: networkFailureResponse(),
            data: null,
            content: null,
            ok: false,
            status: 0,
            errorBody: { error: { message } },
            finishReason: null,
            refusal: null,
          }
        }
      }

      try {
        const first = await attempt(Boolean(schema))
        if (schema && !first.ok && mentionsResponseFormat(first.errorBody)) {
          if (!warnedStructuredOutputsUnsupported) {
            warnedStructuredOutputsUnsupported = true
            console.warn(
              `  [OPENAI] Model ${model} rejected json_schema response_format; falling back to json_object mode.`
            )
          }
          return await attempt(false)
        }
        return first
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}
